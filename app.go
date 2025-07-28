package main

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"
)

// --- Constants ---
var edmReadCommand = []byte{0x11, 0x0d, 0x0a}
var assets embed.FS

const (
	cacheFileName           = "polyfield_results_cache.json"
	cacheRetryInterval      = 2 * time.Minute
	sdToleranceMm           = 3.0
	delayBetweenReadsInPair = 250 * time.Millisecond
	edmReadTimeout          = 10 * time.Second
	UkaRadiusShot           = 1.0675
	UkaRadiusDiscus         = 1.250
	UkaRadiusHammer         = 1.0675
	UkaRadiusJavelinArc     = 8.000
	ToleranceThrowsCircleMm = 5.0
	ToleranceJavelinMm      = 10.0
	windBufferSize          = 120
)

// --- API & Event Mode Structs ---
type EventRules struct {
	Attempts        int  `json:"attempts"`
	CutEnabled      bool `json:"cutEnabled"`
	CutQualifiers   int  `json:"cutQualifiers"`
	ReorderAfterCut bool `json:"reorderAfterCut"`
}
type Athlete struct {
	Bib   string `json:"bib"`
	Order int    `json:"order"`
	Name  string `json:"name"`
	Club  string `json:"club"`
}
type Event struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Type     string     `json:"type"`
	Rules    EventRules `json:"rules,omitempty"`
	Athletes []Athlete  `json:"athletes,omitempty"`
}
type Performance struct {
	Attempt int     `json:"attempt"`
	Mark    string  `json:"mark"`
	Unit    string  `json:"unit"`
	Wind    *string `json:"wind,omitempty"`
	Valid   bool    `json:"valid"`
}
type ResultPayload struct {
	EventID    string        `json:"eventId"`
	AthleteBib string        `json:"athleteBib"`
	Series     []Performance `json:"series"`
}

// --- Standalone Mode & Hardware Structs ---
type Device struct {
	Conn           io.ReadWriteCloser
	ConnectionType string
	Address        string
	cancelListener context.CancelFunc
}
type EDMPoint struct{ X, Y float64 }
type AveragedEDMReading struct{ SlopeDistanceMm, VAzDecimal, HARDecimal float64 }
type EdgeVerificationResult struct {
	MeasuredRadius, DifferenceMm, ToleranceAppliedMm float64
	IsInTolerance                                    bool
}
type EDMCalibrationData struct {
	DeviceID               string
	Timestamp              time.Time
	SelectedCircleType     string
	TargetRadius           float64
	StationCoordinates     EDMPoint
	IsCentreSet            bool
	EdgeVerificationResult *EdgeVerificationResult
}
type ParsedEDMReading struct{ SlopeDistanceMm, VAzDecimal, HARDecimal float64 }
type WindReading struct {
	Value     float64
	Timestamp time.Time
}

// --- Main App Struct ---
type App struct {
	ctx              context.Context
	stateMux         sync.Mutex
	httpClient       *http.Client
	resultCache      []ResultPayload
	cacheFilePath    string
	serverAddress    string
	devices          map[string]*Device
	windBuffer       []WindReading
	demoMode         bool
	CalibrationStore map[string]*EDMCalibrationData
}

// --- App Lifecycle & Helpers ---
func NewApp() *App {
	return &App{
		devices:          make(map[string]*Device),
		CalibrationStore: make(map[string]*EDMCalibrationData),
		httpClient:       &http.Client{Timeout: 10 * time.Second},
		resultCache:      make([]ResultPayload, 0),
		windBuffer:       make([]WindReading, 0, windBufferSize),
		demoMode:         false,
	}
}
func (a *App) wailsStartup(ctx context.Context) {
	a.ctx = ctx
	appDataDir, err := os.UserCacheDir()
	if err != nil {
		log.Printf("Error getting user cache dir: %v", err)
		appDataDir = "."
	}
	a.cacheFilePath = filepath.Join(appDataDir, "polyfield", cacheFileName)
	if err := os.MkdirAll(filepath.Dir(a.cacheFilePath), 0755); err != nil {
		log.Printf("Error creating cache directory: %v", err)
	}
	a.loadResultCache()
	go a.retryCachedResults()
}
func (a *App) wailsShutdown(ctx context.Context) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	for _, dev := range a.devices {
		if dev.cancelListener != nil {
			dev.cancelListener()
		}
		if dev.Conn != nil {
			dev.Conn.Close()
		}
	}
}
func parseDDDMMSSAngle(angleStr string) (float64, error) {
	if len(angleStr) < 6 || len(angleStr) > 7 {
		return 0, fmt.Errorf("invalid angle string length: got %d for '%s'", len(angleStr), angleStr)
	}
	if len(angleStr) == 6 {
		angleStr = "0" + angleStr
	}
	ddd, err := strconv.Atoi(angleStr[0:3])
	if err != nil {
		return 0, err
	}
	mm, err := strconv.Atoi(angleStr[3:5])
	if err != nil {
		return 0, err
	}
	ss, err := strconv.Atoi(angleStr[5:7])
	if err != nil {
		return 0, err
	}
	if mm >= 60 || ss >= 60 {
		return 0, fmt.Errorf("invalid angle values (MM or SS >= 60) in '%s'", angleStr)
	}
	return float64(ddd) + (float64(mm) / 60.0) + (float64(ss) / 3600.0), nil
}
func parseEDMResponseString(raw string) (*ParsedEDMReading, error) {
	parts := strings.Fields(strings.TrimSpace(raw))
	if len(parts) < 4 {
		return nil, fmt.Errorf("malformed response, got %d parts", len(parts))
	}
	sd, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return nil, err
	}
	vaz, err := parseDDDMMSSAngle(parts[1])
	if err != nil {
		return nil, err
	}
	har, err := parseDDDMMSSAngle(parts[2])
	if err != nil {
		return nil, err
	}
	return &ParsedEDMReading{SlopeDistanceMm: sd, VAzDecimal: vaz, HARDecimal: har}, nil
}
func (a *App) parseWindResponse(raw string) (float64, bool) {
	parts := strings.Split(strings.TrimSpace(raw), ",")
	if len(parts) > 1 && (strings.HasPrefix(parts[1], "+") || strings.HasPrefix(parts[1], "-")) {
		val, err := strconv.ParseFloat(parts[1], 64)
		if err == nil {
			return val, true
		}
	}
	return 0, false
}

// --- API Communication & Caching ---
func (a *App) SetServerAddress(ip string, port int) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	a.serverAddress = net.JoinHostPort(ip, strconv.Itoa(port))
}
func (a *App) FetchEvents(ip string, port int) ([]Event, error) {
	host := net.JoinHostPort(ip, strconv.Itoa(port))
	url := fmt.Sprintf("http://%s/api/v1/events", host)
	resp, err := a.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned non-200 status: %s", resp.Status)
	}
	var events []Event
	if err := json.NewDecoder(resp.Body).Decode(&events); err != nil {
		return nil, fmt.Errorf("failed to parse event list: %w", err)
	}
	return events, nil
}
func (a *App) FetchEventDetails(ip string, port int, eventId string) (*Event, error) {
	host := net.JoinHostPort(ip, strconv.Itoa(port))
	url := fmt.Sprintf("http://%s/api/v1/events/%s", host, eventId)
	resp, err := a.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned non-200 status: %s", resp.Status)
	}
	var eventDetails Event
	if err := json.NewDecoder(resp.Body).Decode(&eventDetails); err != nil {
		return nil, fmt.Errorf("failed to parse event details: %w", err)
	}
	return &eventDetails, nil
}
func (a *App) PostResult(ip string, port int, payload ResultPayload) error {
	host := net.JoinHostPort(ip, strconv.Itoa(port))
	url := fmt.Sprintf("http://%s/api/v1/results", host)
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal result payload: %w", err)
	}
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.httpClient.Do(req)
	if err != nil {
		a.addResultToCache(payload)
		return fmt.Errorf("network error, result cached")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		a.addResultToCache(payload)
		return fmt.Errorf("server error (%s), result cached", resp.Status)
	}
	return nil
}
func (a *App) addResultToCache(payload ResultPayload) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	a.resultCache = append(a.resultCache, payload)
	a.saveResultCache()
}
func (a *App) saveResultCache() {
	data, err := json.MarshalIndent(a.resultCache, "", "  ")
	if err != nil {
		log.Printf("Error marshaling result cache: %v", err)
		return
	}
	os.WriteFile(a.cacheFilePath, data, 0644)
}
func (a *App) loadResultCache() {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	data, err := os.ReadFile(a.cacheFilePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("Error reading result cache file: %v", err)
		}
		return
	}
	if err := json.Unmarshal(data, &a.resultCache); err != nil {
		log.Printf("Error unmarshaling result cache: %v", err)
	}
}
func (a *App) retryCachedResults() {
	ticker := time.NewTicker(cacheRetryInterval)
	defer ticker.Stop()
	for {
		<-ticker.C
		a.stateMux.Lock()
		if len(a.resultCache) == 0 {
			a.stateMux.Unlock()
			continue
		}
		serverAddr := a.serverAddress
		if serverAddr == "" {
			a.stateMux.Unlock()
			continue
		}
		log.Printf("Attempting to send %d cached results...", len(a.resultCache))
		var stillCached []ResultPayload
		for _, payload := range a.resultCache {
			url := fmt.Sprintf("http://%s/api/v1/results", serverAddr)
			jsonData, _ := json.Marshal(payload)
			req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
			req.Header.Set("Content-Type", "application/json")
			resp, err := a.httpClient.Do(req)
			if err != nil || (resp != nil && resp.StatusCode != http.StatusOK) {
				stillCached = append(stillCached, payload)
			} else {
				log.Printf("Successfully sent cached result for bib %s", payload.AthleteBib)
			}
			if resp != nil {
				resp.Body.Close()
			}
		}
		a.resultCache = stillCached
		a.saveResultCache()
		a.stateMux.Unlock()
	}
}

// --- Standalone Mode & Hardware Functions ---
func (a *App) SetDemoMode(enabled bool)           { a.stateMux.Lock(); a.demoMode = enabled; a.stateMux.Unlock() }
func (a *App) ListSerialPorts() ([]string, error) { return serial.GetPortsList() }
func (a *App) ConnectSerialDevice(devType, portName string) (string, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	if d, ok := a.devices[devType]; ok && d.Conn != nil {
		if d.cancelListener != nil {
			d.cancelListener()
		}
		d.Conn.Close()
	}
	mode := &serial.Mode{BaudRate: 9600}
	port, err := serial.Open(portName, mode)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.devices[devType] = &Device{Conn: port, ConnectionType: "serial", Address: portName, cancelListener: cancel}
	if devType == "wind" {
		go a.StartWindListener(devType, ctx)
	}
	if devType == "scoreboard" {
		go a.SendToScoreboard("88:88")
	}
	return fmt.Sprintf("Connected to %s on %s", devType, portName), nil
}
func (a *App) ConnectNetworkDevice(devType, ipAddress string, port int) (string, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	if d, ok := a.devices[devType]; ok && d.Conn != nil {
		if d.cancelListener != nil {
			d.cancelListener()
		}
		d.Conn.Close()
	}
	address := net.JoinHostPort(ipAddress, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", address, 5*time.Second)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.devices[devType] = &Device{Conn: conn, ConnectionType: "network", Address: address, cancelListener: cancel}
	if devType == "wind" {
		go a.StartWindListener(devType, ctx)
	}
	if devType == "scoreboard" {
		go a.SendToScoreboard("88:88")
	}
	return fmt.Sprintf("Connected to %s at %s", devType, address), nil
}
func (a *App) DisconnectDevice(devType string) (string, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	if dev, ok := a.devices[devType]; ok && dev.Conn != nil {
		if dev.cancelListener != nil {
			dev.cancelListener()
		}
		dev.Conn.Close()
		delete(a.devices, devType)
		return fmt.Sprintf("Disconnected %s", devType), nil
	}
	return "", fmt.Errorf("%s not connected", devType)
}
func (a *App) GetCalibration(devType string) (*EDMCalibrationData, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	if cal, exists := a.CalibrationStore[devType]; exists {
		return cal, nil
	}
	return &EDMCalibrationData{DeviceID: devType, SelectedCircleType: "SHOT", TargetRadius: UkaRadiusShot}, nil
}
func (a *App) SaveCalibration(devType string, data EDMCalibrationData) error {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	if existingCal, ok := a.CalibrationStore[devType]; ok {
		data.Timestamp = existingCal.Timestamp
	}
	a.CalibrationStore[devType] = &data
	return nil
}
func (a *App) ResetCalibration(devType string) error {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	delete(a.CalibrationStore, devType)
	return nil
}
func (a *App) _triggerSingleEDMRead(dev *Device) (*ParsedEDMReading, error) {
	if _, err := dev.Conn.Write([]byte(edmReadCommand)); err != nil {
		return nil, err
	}
	if dev.ConnectionType == "network" {
		if conn, ok := dev.Conn.(net.Conn); ok {
			conn.SetReadDeadline(time.Now().Add(edmReadTimeout))
			defer conn.SetReadDeadline(time.Time{})
		}
	}
	r := bufio.NewReader(dev.Conn)
	resp, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	return parseEDMResponseString(resp)
}
func (a *App) GetReliableEDMReading(devType string) (*AveragedEDMReading, error) {
	a.stateMux.Lock()
	if a.demoMode {
		a.stateMux.Unlock()
		return &AveragedEDMReading{SlopeDistanceMm: 10000 + rand.Float64()*15000, VAzDecimal: 92.0 + rand.Float64()*5.0, HARDecimal: rand.Float64() * 360.0}, nil
	}
	device, ok := a.devices[devType]
	a.stateMux.Unlock()
	if !ok || device.Conn == nil {
		return nil, fmt.Errorf("EDM device type '%s' not connected", devType)
	}

	r1, e1 := a._triggerSingleEDMRead(device)
	if e1 != nil {
		return nil, fmt.Errorf("first read failed: %w", e1)
	}

	time.Sleep(delayBetweenReadsInPair)

	r2, e2 := a._triggerSingleEDMRead(device)
	if e2 != nil {
		return nil, fmt.Errorf("second read failed: %w", e2)
	}

	if math.Abs(r1.SlopeDistanceMm-r2.SlopeDistanceMm) <= sdToleranceMm {
		return &AveragedEDMReading{
			SlopeDistanceMm: (r1.SlopeDistanceMm + r2.SlopeDistanceMm) / 2.0,
			VAzDecimal:      (r1.VAzDecimal + r2.VAzDecimal) / 2.0,
			HARDecimal:      (r1.HARDecimal + r2.HARDecimal) / 2.0,
		}, nil
	}
	return nil, fmt.Errorf("readings inconsistent. R1(SD): %.0fmm, R2(SD): %.0fmm", r1.SlopeDistanceMm, r2.SlopeDistanceMm)
}
func (a *App) SetCircleCentre(devType string) (*EDMCalibrationData, error) {
	reading, err := a.GetReliableEDMReading(devType)
	if err != nil {
		return nil, fmt.Errorf("could not get centre reading: %w", err)
	}
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	cal, _ := a.CalibrationStore[devType]
	if cal == nil {
		cal = &EDMCalibrationData{DeviceID: devType, SelectedCircleType: "SHOT", TargetRadius: UkaRadiusShot}
	}
	sdMeters := reading.SlopeDistanceMm / 1000.0
	vazRad := reading.VAzDecimal * math.Pi / 180.0
	harRad := reading.HARDecimal * math.Pi / 180.0
	hd := sdMeters * math.Sin(vazRad)
	cal.StationCoordinates = EDMPoint{X: -hd * math.Cos(harRad), Y: -hd * math.Sin(harRad)}
	cal.IsCentreSet = true
	cal.EdgeVerificationResult = nil
	cal.Timestamp = time.Now().UTC()
	a.CalibrationStore[devType] = cal
	return cal, nil
}
func (a *App) VerifyCircleEdge(devType string) (*EDMCalibrationData, error) {
	a.stateMux.Lock()
	cal, exists := a.CalibrationStore[devType]
	if !exists || !cal.IsCentreSet {
		a.stateMux.Unlock()
		return nil, fmt.Errorf("must set circle centre first")
	}
	if a.demoMode {
		a.stateMux.Unlock()
		diffMm := (rand.Float64() * 12.0) - 6.0
		toleranceMm := ToleranceThrowsCircleMm
		if cal.SelectedCircleType == "JAVELIN_ARC" {
			toleranceMm = ToleranceJavelinMm
		}
		cal.EdgeVerificationResult = &EdgeVerificationResult{MeasuredRadius: cal.TargetRadius + (diffMm / 1000.0), DifferenceMm: diffMm, IsInTolerance: math.Abs(diffMm) <= toleranceMm, ToleranceAppliedMm: toleranceMm}
		return cal, nil
	}
	a.stateMux.Unlock()
	reading, err := a.GetReliableEDMReading(devType)
	if err != nil {
		return nil, fmt.Errorf("could not get edge reading: %w", err)
	}
	sdMeters := reading.SlopeDistanceMm / 1000.0
	vazRad := reading.VAzDecimal * math.Pi / 180.0
	harRad := reading.HARDecimal * math.Pi / 180.0
	hd := sdMeters * math.Sin(vazRad)
	xPrime := hd * math.Cos(harRad)
	yPrime := hd * math.Sin(harRad)
	measuredX := cal.StationCoordinates.X + xPrime
	measuredY := cal.StationCoordinates.Y + yPrime
	measuredRadius := math.Sqrt(math.Pow(measuredX, 2) + math.Pow(measuredY, 2))
	diffMm := (measuredRadius - cal.TargetRadius) * 1000.0
	toleranceMm := ToleranceThrowsCircleMm
	if cal.SelectedCircleType == "JAVELIN_ARC" {
		toleranceMm = ToleranceJavelinMm
	}
	cal.EdgeVerificationResult = &EdgeVerificationResult{MeasuredRadius: measuredRadius, DifferenceMm: diffMm, IsInTolerance: math.Abs(diffMm) <= toleranceMm, ToleranceAppliedMm: toleranceMm}
	a.stateMux.Lock()
	a.CalibrationStore[devType] = cal
	a.stateMux.Unlock()
	return cal, nil
}
func (a *App) MeasureThrow(devType string) (string, error) {
	a.stateMux.Lock()
	cal, exists := a.CalibrationStore[devType]
	if !exists || !cal.IsCentreSet {
		a.stateMux.Unlock()
		return "", fmt.Errorf("EDM is not calibrated")
	}
	if a.demoMode {
		a.stateMux.Unlock()
		var min, max float64
		switch cal.SelectedCircleType {
		case "SHOT":
			min, max = 6.00, 15.00
		default:
			min, max = 15.00, 60.00
		}
		result := fmt.Sprintf("%.2f m", min+rand.Float64()*(max-min))
		go a.SendToScoreboard(strings.TrimSuffix(result, " m"))
		return result, nil
	}
	a.stateMux.Unlock()
	reading, err := a.GetReliableEDMReading(devType)
	if err != nil {
		return "", fmt.Errorf("could not get throw reading: %w", err)
	}
	sdMeters := reading.SlopeDistanceMm / 1000.0
	vazRad := reading.VAzDecimal * math.Pi / 180.0
	harRad := reading.HARDecimal * math.Pi / 180.0
	hd := sdMeters * math.Sin(vazRad)
	xPrime := hd * math.Cos(harRad)
	yPrime := hd * math.Sin(harRad)
	measuredX := cal.StationCoordinates.X + xPrime
	measuredY := cal.StationCoordinates.Y + yPrime
	distFromCenter := math.Sqrt(math.Pow(measuredX, 2) + math.Pow(measuredY, 2))
	finalThrowDist := distFromCenter - cal.TargetRadius
	result := fmt.Sprintf("%.2f m", finalThrowDist)
	go a.SendToScoreboard(strings.TrimSuffix(result, " m"))
	return result, nil
}
func (a *App) StartWindListener(devType string, ctx context.Context) {
	a.stateMux.Lock()
	device, ok := a.devices[devType]
	a.stateMux.Unlock()
	if !ok {
		return
	}
	scanner := bufio.NewScanner(device.Conn)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			log.Printf("Stopping wind listener for %s", devType)
			return
		default:
			text := scanner.Text()
			if val, ok := a.parseWindResponse(text); ok {
				a.stateMux.Lock()
				a.windBuffer = append(a.windBuffer, WindReading{Value: val, Timestamp: time.Now()})
				if len(a.windBuffer) > windBufferSize {
					a.windBuffer = a.windBuffer[1:]
				}
				a.stateMux.Unlock()
			}
		}
	}
}
func (a *App) MeasureWind(devType string) (string, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	if a.demoMode {
		windSpeed := (rand.Float64() * 4.0) - 2.0
		result := fmt.Sprintf("%+.1f m/s", windSpeed)
		go a.SendToScoreboard(result)
		return result, nil
	}
	_, ok := a.devices[devType]
	if !ok {
		return "", fmt.Errorf("wind gauge not connected")
	}
	now := time.Now()
	fiveSecondsAgo := now.Add(-5 * time.Second)
	var readingsInWindow []float64
	for _, reading := range a.windBuffer {
		if reading.Timestamp.After(fiveSecondsAgo) {
			readingsInWindow = append(readingsInWindow, reading.Value)
		}
	}
	if len(readingsInWindow) == 0 {
		return "", fmt.Errorf("no wind readings in the last 5 seconds")
	}
	var sum float64
	for _, v := range readingsInWindow {
		sum += v
	}
	avg := sum / float64(len(readingsInWindow))
	result := fmt.Sprintf("%+.1f m/s", avg)
	go a.SendToScoreboard(result)
	return result, nil
}
func (a *App) SendToScoreboard(value string) error {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	if a.demoMode {
		log.Printf("DEMO: Would send '%s' to scoreboard", value)
		return nil
	}
	scoreboard, ok := a.devices["scoreboard"]
	if !ok || scoreboard.Conn == nil {
		return fmt.Errorf("scoreboard not connected")
	}
	_, err := scoreboard.Conn.Write([]byte(value + "\r\n"))
	if err != nil {
		return fmt.Errorf("failed to write to scoreboard: %w", err)
	}
	return nil
}

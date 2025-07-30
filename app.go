package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"
)

// --- Constants ---
var edmReadCommand = []byte{0x11, 0x0d, 0x0a}

const (
	sdToleranceMm           = 3.0
	delayBetweenReadsInPair = 250 * time.Millisecond
	edmReadTimeout          = 10 * time.Second
	windBufferSize          = 120 // Approx 2 minutes of data at 1 reading/sec
)

// UKA Official Circle Radii (as per methodology guide)
const (
	UkaRadiusShot       = 1.0675 // Shot put circle radius (meters)
	UkaRadiusDiscus     = 1.250  // Discus circle radius (meters)
	UkaRadiusHammer     = 1.0675 // Hammer circle radius (meters)
	UkaRadiusJavelinArc = 8.000  // Javelin arc radius (meters)
)

// Tolerance constants
const (
	ToleranceThrowsCircleMm = 5.0  // Standard tolerance for throws circles
	ToleranceJavelinMm      = 10.0 // Tolerance for javelin arc
)

// Demo mode delays
const (
	CENTRE_DELAY = 2000 * time.Millisecond
	EDGE_DELAY   = 2000 * time.Millisecond
	THROW_DELAY  = 1500 * time.Millisecond
)

// --- Data Structures ---
type Device struct {
	Conn           io.ReadWriteCloser
	ConnectionType string
	Address        string
	cancelListener context.CancelFunc // To stop the listener goroutine
}

type WindReading struct {
	Value     float64
	Timestamp time.Time
}

type EDMPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type AveragedEDMReading struct {
	SlopeDistanceMm float64 `json:"slopeDistanceMm"`
	VAzDecimal      float64 `json:"vAzDecimal"`
	HARDecimal      float64 `json:"harDecimal"`
}

type EdgeVerificationResult struct {
	MeasuredRadius     float64 `json:"measuredRadius"`
	DifferenceMm       float64 `json:"differenceMm"`
	IsInTolerance      bool    `json:"isInTolerance"`
	ToleranceAppliedMm float64 `json:"toleranceAppliedMm"`
}

type EDMCalibrationData struct {
	DeviceID               string                  `json:"deviceId"`
	Timestamp              time.Time               `json:"timestamp"`
	SelectedCircleType     string                  `json:"selectedCircleType"`
	TargetRadius           float64                 `json:"targetRadius"`
	StationCoordinates     EDMPoint                `json:"stationCoordinates"`
	IsCentreSet            bool                    `json:"isCentreSet"`
	EdgeVerificationResult *EdgeVerificationResult `json:"edgeVerificationResult,omitempty"`
}

type ParsedEDMReading struct {
	SlopeDistanceMm float64
	VAzDecimal      float64
	HARDecimal      float64
}

// Throw coordinate data structure
type ThrowCoordinate struct {
	X                float64   `json:"x"`                // X coordinate (metres from centre)
	Y                float64   `json:"y"`                // Y coordinate (metres from centre)
	Distance         float64   `json:"distance"`         // Calculated throw distance
	CircleType       string    `json:"circleType"`       // SHOT, DISCUS, HAMMER, JAVELIN_ARC
	Timestamp        time.Time `json:"timestamp"`        // When the throw was measured
	AthleteID        string    `json:"athleteId"`        // Optional athlete identifier
	CompetitionRound string    `json:"competitionRound"` // Optional round/session identifier
	EDMReading       string    `json:"edmReading"`       // Raw EDM reading for reference
}

// Session data for grouping throws
type ThrowSession struct {
	SessionID   string             `json:"sessionId"`
	CircleType  string             `json:"circleType"`
	StartTime   time.Time          `json:"startTime"`
	EndTime     *time.Time         `json:"endTime,omitempty"`
	Coordinates []ThrowCoordinate  `json:"coordinates"`
	Statistics  *SessionStatistics `json:"statistics,omitempty"`
}

// Statistics for a session
type SessionStatistics struct {
	TotalThrows     int     `json:"totalThrows"`
	AverageX        float64 `json:"averageX"`
	AverageY        float64 `json:"averageY"`
	MaxDistance     float64 `json:"maxDistance"`
	MinDistance     float64 `json:"minDistance"`
	AverageDistance float64 `json:"averageDistance"`
	SpreadRadius    float64 `json:"spreadRadius"` // Standard deviation of landing positions
}

// Demo simulation state to maintain consistency
type DemoSimulation struct {
	stationX      float64
	stationY      float64
	centreReading *AveragedEDMReading
	initialized   bool
}

type App struct {
	ctx              context.Context
	stateMux         sync.Mutex
	devices          map[string]*Device
	windBuffer       []WindReading
	demoMode         bool
	CalibrationStore map[string]*EDMCalibrationData
	demoSim          map[string]*DemoSimulation // Per-device demo simulation

	// Throw coordinate tracking
	throwCoordinates []ThrowCoordinate `json:"throwCoordinates"` // All recorded throws
	currentSession   *ThrowSession     `json:"currentSession"`   // Current active session

	// API communication fields for client mode
	httpClient    *http.Client
	resultCache   []ResultPayload
	cacheFilePath string
	serverAddress string
}

// Event Mode API & Result structures for client communication
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

// --- Helper Functions ---
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

// --- Demo Simulation Functions ---

// Initialize demo simulation for a device based on calibration
func (a *App) initDemoSimulation(devType string, targetRadius float64) {
	// Generate realistic station position
	// Station should be 5-15 meters from centre at various angles
	distance := 8.0 + rand.Float64()*7.0  // 8-15 meters
	angle := rand.Float64() * 2 * math.Pi // Random angle

	stationX := distance * math.Cos(angle)
	stationY := distance * math.Sin(angle)

	log.Printf("DEMO: Initialized simulation for %s with station at X=%.4fm, Y=%.4fm", devType, stationX, stationY)

	a.demoSim[devType] = &DemoSimulation{
		stationX:    stationX,
		stationY:    stationY,
		initialized: true,
	}
}

// Generate realistic demo centre reading
func (a *App) generateDemoCentreReading(devType string, targetRadius float64) *AveragedEDMReading {
	sim, exists := a.demoSim[devType]
	if !exists {
		a.initDemoSimulation(devType, targetRadius)
		sim = a.demoSim[devType]
	}

	// Calculate realistic EDM reading from station to centre (0,0)
	distanceToCenter := math.Sqrt(sim.stationX*sim.stationX + sim.stationY*sim.stationY)

	// Calculate horizontal angle (bearing from station to centre)
	harDegrees := math.Atan2(-sim.stationY, -sim.stationX) * 180.0 / math.Pi
	if harDegrees < 0 {
		harDegrees += 360.0 // Ensure positive angle
	}

	// Vertical angle (slightly elevated, typical for EDM)
	vazDegrees := 88.0 + rand.Float64()*4.0 // 88-92 degrees (nearly vertical)

	// Calculate slope distance from horizontal distance and vertical angle
	vazRad := vazDegrees * math.Pi / 180.0
	slopeDistance := distanceToCenter / math.Sin(vazRad)

	// Add small random measurement noise
	slopeDistance += (rand.Float64() - 0.5) * 0.01 // ±5mm noise
	harDegrees += (rand.Float64() - 0.5) * 0.1     // ±0.05 degree noise
	vazDegrees += (rand.Float64() - 0.5) * 0.1     // ±0.05 degree noise

	reading := &AveragedEDMReading{
		SlopeDistanceMm: slopeDistance * 1000.0,
		VAzDecimal:      vazDegrees,
		HARDecimal:      harDegrees,
	}

	// Store for consistency
	sim.centreReading = reading

	log.Printf("DEMO: Generated centre reading - SD: %.0fmm, VAz: %.4f°, HAR: %.4f°",
		reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal)

	return reading
}

// Generate realistic demo edge reading within tolerance
func (a *App) generateDemoEdgeReading(devType string, targetRadius float64) *AveragedEDMReading {
	sim, exists := a.demoSim[devType]
	if !exists || sim.centreReading == nil {
		log.Printf("DEMO ERROR: No centre reading found for %s, generating fallback", devType)
		a.generateDemoCentreReading(devType, targetRadius)
		sim = a.demoSim[devType]
	}

	// Generate a point on the circle edge with SMALLER tolerance variation
	// Ensure we stay within ±5mm (±0.005m) for throws, ±10mm for javelin
	maxVariationMm := 4.0                                                    // Stay well within 5mm tolerance
	toleranceVariation := (rand.Float64() - 0.5) * (maxVariationMm / 1000.0) // Convert to meters
	effectiveRadius := targetRadius + toleranceVariation

	// Random angle around the circle
	edgeAngle := rand.Float64() * 2 * math.Pi
	edgeX := effectiveRadius * math.Cos(edgeAngle)
	edgeY := effectiveRadius * math.Sin(edgeAngle)

	// Calculate EDM reading from station to this edge point
	deltaX := edgeX - sim.stationX
	deltaY := edgeY - sim.stationY
	distanceToEdge := math.Sqrt(deltaX*deltaX + deltaY*deltaY)

	// Calculate horizontal angle
	harDegrees := math.Atan2(deltaY, deltaX) * 180.0 / math.Pi
	if harDegrees < 0 {
		harDegrees += 360.0
	}

	// Vertical angle (similar to centre reading with slight variation)
	vazDegrees := sim.centreReading.VAzDecimal + (rand.Float64()-0.5)*1.0 // Reduced variation

	// Calculate slope distance
	vazRad := vazDegrees * math.Pi / 180.0
	slopeDistance := distanceToEdge / math.Sin(vazRad)

	// REDUCED measurement noise for better consistency
	slopeDistance += (rand.Float64() - 0.5) * 0.005 // ±2.5mm noise instead of ±10mm
	harDegrees += (rand.Float64() - 0.5) * 0.05     // ±0.025 degree noise
	vazDegrees += (rand.Float64() - 0.5) * 0.05     // ±0.025 degree noise

	reading := &AveragedEDMReading{
		SlopeDistanceMm: slopeDistance * 1000.0,
		VAzDecimal:      vazDegrees,
		HARDecimal:      harDegrees,
	}

	expectedDifferenceMm := toleranceVariation * 1000.0
	log.Printf("DEMO: Generated edge reading - SD: %.0fmm, VAz: %.4f°, HAR: %.4f°",
		reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal)
	log.Printf("DEMO: Edge point at X=%.4fm, Y=%.4fm (radius: %.4fm, expected diff: %.1fmm)",
		edgeX, edgeY, effectiveRadius, expectedDifferenceMm)

	return reading
}

// Generate realistic demo throw reading
func (a *App) generateDemoThrowReading(devType string, targetRadius float64, circleType string) *AveragedEDMReading {
	sim, exists := a.demoSim[devType]
	if !exists || sim.centreReading == nil {
		log.Printf("DEMO ERROR: No centre reading found for %s, generating fallback", devType)
		a.generateDemoCentreReading(devType, targetRadius)
		sim = a.demoSim[devType]
	}

	// Generate realistic throw distance based on event type
	var minThrow, maxThrow float64
	switch circleType {
	case "SHOT":
		minThrow, maxThrow = 8.0, 18.0
	case "DISCUS":
		minThrow, maxThrow = 25.0, 65.0
	case "HAMMER":
		minThrow, maxThrow = 20.0, 75.0
	case "JAVELIN_ARC":
		minThrow, maxThrow = 35.0, 85.0
	default:
		minThrow, maxThrow = 15.0, 50.0
	}

	throwDistance := minThrow + rand.Float64()*(maxThrow-minThrow)
	totalDistanceFromCentre := throwDistance + targetRadius

	// Random throw angle (simulate realistic landing sector)
	throwAngle := (rand.Float64() - 0.5) * math.Pi / 3 // ±30 degrees from forward

	// Calculate throw landing point
	throwX := totalDistanceFromCentre * math.Cos(throwAngle)
	throwY := totalDistanceFromCentre * math.Sin(throwAngle)

	// Calculate EDM reading from station to throw point
	deltaX := throwX - sim.stationX
	deltaY := throwY - sim.stationY
	distanceToThrow := math.Sqrt(deltaX*deltaX + deltaY*deltaY)

	// Calculate horizontal angle
	harDegrees := math.Atan2(deltaY, deltaX) * 180.0 / math.Pi
	if harDegrees < 0 {
		harDegrees += 360.0
	}

	// Vertical angle (similar to centre reading with variation)
	vazDegrees := sim.centreReading.VAzDecimal + (rand.Float64()-0.5)*3.0 // ±1.5 degree variation

	// Calculate slope distance
	vazRad := vazDegrees * math.Pi / 180.0
	slopeDistance := distanceToThrow / math.Sin(vazRad)

	// Add measurement noise
	slopeDistance += (rand.Float64() - 0.5) * 0.02
	harDegrees += (rand.Float64() - 0.5) * 0.1
	vazDegrees += (rand.Float64() - 0.5) * 0.1

	reading := &AveragedEDMReading{
		SlopeDistanceMm: slopeDistance * 1000.0,
		VAzDecimal:      vazDegrees,
		HARDecimal:      harDegrees,
	}

	log.Printf("DEMO: Generated throw reading - SD: %.0fmm, VAz: %.4f°, HAR: %.4f°",
		reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal)
	log.Printf("DEMO: Throw landing at X=%.4fm, Y=%.4fm (expected distance: %.2fm)",
		throwX, throwY, throwDistance)

	return reading
}

// --- Core EDM Functions (Corrected Implementation) ---

func (a *App) _triggerSingleEDMRead(dev *Device) (*ParsedEDMReading, error) {
	if _, err := dev.Conn.Write(edmReadCommand); err != nil {
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
		return &AveragedEDMReading{
			SlopeDistanceMm: 10000 + rand.Float64()*15000,
			VAzDecimal:      92.0 + rand.Float64()*5.0,
			HARDecimal:      rand.Float64() * 360.0,
		}, nil
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

// CORRECTED EDM CALCULATION IMPLEMENTATION
func (a *App) SetCircleCentre(devType string) (*EDMCalibrationData, error) {
	var reading *AveragedEDMReading
	var err error

	a.stateMux.Lock()
	isDemoMode := a.demoMode
	cal, exists := a.CalibrationStore[devType]
	if !exists {
		cal = &EDMCalibrationData{
			DeviceID:           devType,
			SelectedCircleType: "SHOT",
			TargetRadius:       UkaRadiusShot,
		}
	}
	targetRadius := cal.TargetRadius
	circleType := cal.SelectedCircleType
	a.stateMux.Unlock()

	if isDemoMode {
		// Use dynamic demo data with delay
		time.Sleep(CENTRE_DELAY)
		reading = a.generateDemoCentreReading(devType, targetRadius)
		log.Printf("DEMO: Centre reading for %s circle (%.4fm) - SD: %.0fmm, VAz: %.4f°, HAR: %.4f°",
			circleType, targetRadius, reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal)
	} else {
		reading, err = a.GetReliableEDMReading(devType)
		if err != nil {
			return nil, fmt.Errorf("could not get centre reading: %w", err)
		}
		log.Printf("EDM Centre reading for %s circle (%.4fm) - SD: %.0fmm, VAz: %.4f°, HAR: %.4f°",
			circleType, targetRadius, reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal)
	}

	// Convert to meters and radians for calculation
	sdMeters := reading.SlopeDistanceMm / 1000.0

	// CRITICAL: Convert degrees to radians for Math functions
	vazRad := reading.VAzDecimal * math.Pi / 180.0
	harRad := reading.HARDecimal * math.Pi / 180.0

	// Calculate horizontal distance using sine of vertical angle
	horizontalDistance := sdMeters * math.Sin(vazRad)

	// Calculate station coordinates relative to circle centre
	// Using negative values as we're calculating station position relative to centre
	stationX := -horizontalDistance * math.Cos(harRad)
	stationY := -horizontalDistance * math.Sin(harRad)

	log.Printf("Calculated station coordinates: X=%.4fm, Y=%.4fm", stationX, stationY)
	log.Printf("Horizontal distance to centre: %.4fm", horizontalDistance)

	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	// Update calibration data while preserving circle type and radius
	cal.StationCoordinates = EDMPoint{X: stationX, Y: stationY}
	cal.IsCentreSet = true
	cal.EdgeVerificationResult = nil // Reset edge verification
	cal.Timestamp = time.Now().UTC()

	a.CalibrationStore[devType] = cal
	return cal, nil
}

func (a *App) VerifyCircleEdge(devType string) (*EDMCalibrationData, error) {
	a.stateMux.Lock()
	cal, exists := a.CalibrationStore[devType]
	isDemoMode := a.demoMode
	if !exists || !cal.IsCentreSet {
		a.stateMux.Unlock()
		return nil, fmt.Errorf("must set circle centre first")
	}

	// CRITICAL FIX: Use the CORRECT target radius from calibration data
	targetRadius := cal.TargetRadius
	circleType := cal.SelectedCircleType
	a.stateMux.Unlock()

	var reading *AveragedEDMReading
	var err error

	if isDemoMode {
		// Use dynamic demo data with delay
		time.Sleep(EDGE_DELAY)
		reading = a.generateDemoEdgeReading(devType, targetRadius)
		log.Printf("DEMO: Edge reading for %s circle (%.4fm) - SD: %.0fmm, VAz: %.4f°, HAR: %.4f°",
			circleType, targetRadius, reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal)
	} else {
		reading, err = a.GetReliableEDMReading(devType)
		if err != nil {
			return nil, fmt.Errorf("could not get edge reading: %w", err)
		}
		log.Printf("EDM Edge reading for %s circle (%.4fm) - SD: %.0fmm, VAz: %.4f°, HAR: %.4f°",
			circleType, targetRadius, reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal)
	}

	// Convert to meters and radians
	sdMeters := reading.SlopeDistanceMm / 1000.0
	vazRad := reading.VAzDecimal * math.Pi / 180.0
	harRad := reading.HARDecimal * math.Pi / 180.0

	// Calculate horizontal distance
	horizontalDistance := sdMeters * math.Sin(vazRad)

	// Calculate edge point coordinates relative to centre
	edgeX := horizontalDistance * math.Cos(harRad)
	edgeY := horizontalDistance * math.Sin(harRad)

	// Calculate absolute edge position (station coordinates + edge offset)
	absoluteEdgeX := cal.StationCoordinates.X + edgeX
	absoluteEdgeY := cal.StationCoordinates.Y + edgeY

	// Calculate distance from centre (origin) to edge point using cosine rule
	measuredRadius := math.Sqrt(math.Pow(absoluteEdgeX, 2) + math.Pow(absoluteEdgeY, 2))

	// CRITICAL FIX: Use the target radius from calibration data, not hardcoded value
	diffMm := (measuredRadius - targetRadius) * 1000.0

	// Determine tolerance based on circle type
	toleranceMm := ToleranceThrowsCircleMm
	if circleType == "JAVELIN_ARC" {
		toleranceMm = ToleranceJavelinMm
	}

	isInTolerance := math.Abs(diffMm) <= toleranceMm

	log.Printf("Edge verification calculations:")
	log.Printf("  Circle type: %s", circleType)
	log.Printf("  Target radius: %.4fm", targetRadius)
	log.Printf("  Edge coordinates relative to centre: X=%.4fm, Y=%.4fm", absoluteEdgeX, absoluteEdgeY)
	log.Printf("  Measured radius: %.4fm", measuredRadius)
	log.Printf("  Difference: %.1fmm (Tolerance: ±%.1fmm)", diffMm, toleranceMm)
	log.Printf("  Result: %s", map[bool]string{true: "PASS", false: "FAIL"}[isInTolerance])

	cal.EdgeVerificationResult = &EdgeVerificationResult{
		MeasuredRadius:     measuredRadius,
		DifferenceMm:       diffMm,
		IsInTolerance:      isInTolerance,
		ToleranceAppliedMm: toleranceMm,
	}

	a.stateMux.Lock()
	a.CalibrationStore[devType] = cal
	a.stateMux.Unlock()

	return cal, nil
}

func (a *App) MeasureThrow(devType string) (string, error) {
	a.stateMux.Lock()
	cal, exists := a.CalibrationStore[devType]
	isDemoMode := a.demoMode
	if !exists || !cal.IsCentreSet {
		a.stateMux.Unlock()
		return "", fmt.Errorf("EDM is not calibrated - centre not set")
	}

	// Check edge verification if not in demo mode
	if !isDemoMode && (cal.EdgeVerificationResult == nil || !cal.EdgeVerificationResult.IsInTolerance) {
		a.stateMux.Unlock()
		return "", fmt.Errorf("EDM must be calibrated with valid edge verification before measurement")
	}

	targetRadius := cal.TargetRadius
	circleType := cal.SelectedCircleType
	a.stateMux.Unlock()

	var reading *AveragedEDMReading
	var err error

	if isDemoMode {
		time.Sleep(THROW_DELAY)
		reading = a.generateDemoThrowReading(devType, targetRadius, circleType)
	} else {
		reading, err = a.GetReliableEDMReading(devType)
		if err != nil {
			return "", fmt.Errorf("could not get throw reading: %w", err)
		}
	}

	log.Printf("EDM Throw reading for %s circle - SD: %.0fmm, VAz: %.4f°, HAR: %.4f°",
		circleType, reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal)

	// Convert to meters and radians
	sdMeters := reading.SlopeDistanceMm / 1000.0
	vazRad := reading.VAzDecimal * math.Pi / 180.0
	harRad := reading.HARDecimal * math.Pi / 180.0

	// Calculate horizontal distance
	horizontalDistance := sdMeters * math.Sin(vazRad)

	// Calculate throw landing point coordinates relative to centre
	throwX := horizontalDistance * math.Cos(harRad)
	throwY := horizontalDistance * math.Sin(harRad)

	// Calculate absolute throw position (station coordinates + throw offset)
	absoluteThrowX := cal.StationCoordinates.X + throwX
	absoluteThrowY := cal.StationCoordinates.Y + throwY

	// Calculate distance from centre to throw landing point
	distanceFromCentre := math.Sqrt(math.Pow(absoluteThrowX, 2) + math.Pow(absoluteThrowY, 2))

	// Subtract circle radius to get final throw distance
	finalThrowDistance := distanceFromCentre - targetRadius

	log.Printf("Throw measurement calculations:")
	log.Printf("  Horizontal distance from station: %.4fm", horizontalDistance)
	log.Printf("  Throw coordinates relative to centre: X=%.4fm, Y=%.4fm", absoluteThrowX, absoluteThrowY)
	log.Printf("  Distance from centre: %.4fm", distanceFromCentre)
	log.Printf("  Circle radius: %.4fm", targetRadius)
	log.Printf("  Final throw distance: %.4fm", finalThrowDistance)

	// STORE THE COORDINATES
	a.storeThrowCoordinate(ThrowCoordinate{
		X:          absoluteThrowX,
		Y:          absoluteThrowY,
		Distance:   finalThrowDistance,
		CircleType: circleType,
		Timestamp:  time.Now().UTC(),
		EDMReading: fmt.Sprintf("%.0f %.6f %.6f", reading.SlopeDistanceMm, reading.VAzDecimal, reading.HARDecimal),
	})

	result := fmt.Sprintf("%.2f m", finalThrowDistance)
	go a.SendToScoreboard(strings.TrimSuffix(result, " m"))
	return result, nil
}

// --- Throw Coordinate Storage and Management Functions ---

// Store throw coordinate
func (a *App) storeThrowCoordinate(coord ThrowCoordinate) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	// Add to overall coordinates list
	a.throwCoordinates = append(a.throwCoordinates, coord)

	// Add to current session if active
	if a.currentSession != nil && a.currentSession.CircleType == coord.CircleType {
		a.currentSession.Coordinates = append(a.currentSession.Coordinates, coord)
		a.updateSessionStatistics()
	}

	log.Printf("Stored throw coordinate: (%.4f, %.4f) for %s, distance: %.2fm",
		coord.X, coord.Y, coord.CircleType, coord.Distance)
}

// Session management functions
func (a *App) StartThrowSession(circleType string, sessionID string) error {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	// End current session if exists
	if a.currentSession != nil {
		now := time.Now().UTC()
		a.currentSession.EndTime = &now
		a.updateSessionStatistics()
	}

	// Start new session
	a.currentSession = &ThrowSession{
		SessionID:   sessionID,
		CircleType:  circleType,
		StartTime:   time.Now().UTC(),
		Coordinates: make([]ThrowCoordinate, 0),
	}

	log.Printf("Started new throw session: %s for %s", sessionID, circleType)
	return nil
}

func (a *App) EndThrowSession() (*ThrowSession, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	if a.currentSession == nil {
		return nil, fmt.Errorf("no active session")
	}

	now := time.Now().UTC()
	a.currentSession.EndTime = &now
	a.updateSessionStatistics()

	session := a.currentSession
	a.currentSession = nil

	log.Printf("Ended throw session: %s with %d throws", session.SessionID, len(session.Coordinates))
	return session, nil
}

// Update session statistics
func (a *App) updateSessionStatistics() {
	if a.currentSession == nil || len(a.currentSession.Coordinates) == 0 {
		return
	}

	coords := a.currentSession.Coordinates
	stats := &SessionStatistics{
		TotalThrows: len(coords),
	}

	var sumX, sumY, sumDistance float64
	var maxDist, minDist float64 = coords[0].Distance, coords[0].Distance

	for _, coord := range coords {
		sumX += coord.X
		sumY += coord.Y
		sumDistance += coord.Distance

		if coord.Distance > maxDist {
			maxDist = coord.Distance
		}
		if coord.Distance < minDist {
			minDist = coord.Distance
		}
	}

	stats.AverageX = sumX / float64(len(coords))
	stats.AverageY = sumY / float64(len(coords))
	stats.AverageDistance = sumDistance / float64(len(coords))
	stats.MaxDistance = maxDist
	stats.MinDistance = minDist

	// Calculate spread radius (standard deviation of positions from average)
	var sumSquaredDist float64
	for _, coord := range coords {
		dx := coord.X - stats.AverageX
		dy := coord.Y - stats.AverageY
		sumSquaredDist += dx*dx + dy*dy
	}
	stats.SpreadRadius = math.Sqrt(sumSquaredDist / float64(len(coords)))

	a.currentSession.Statistics = stats
}

// Export functions
func (a *App) ExportThrowCoordinates() ([]ThrowCoordinate, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	// Return copy of all coordinates
	coordinates := make([]ThrowCoordinate, len(a.throwCoordinates))
	copy(coordinates, a.throwCoordinates)

	log.Printf("Exported %d throw coordinates", len(coordinates))
	return coordinates, nil
}

func (a *App) ExportThrowCoordinatesForCircle(circleType string) ([]ThrowCoordinate, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	var filtered []ThrowCoordinate
	for _, coord := range a.throwCoordinates {
		if coord.CircleType == circleType {
			filtered = append(filtered, coord)
		}
	}

	log.Printf("Exported %d throw coordinates for %s", len(filtered), circleType)
	return filtered, nil
}

func (a *App) ExportThrowCoordinatesAsCSV() (string, error) {
	a.stateMux.Lock()
	coordinates := make([]ThrowCoordinate, len(a.throwCoordinates))
	copy(coordinates, a.throwCoordinates)
	a.stateMux.Unlock()

	var csvData strings.Builder
	csvData.WriteString("X,Y,Distance,CircleType,Timestamp,AthleteID,CompetitionRound,EDMReading\n")

	for _, coord := range coordinates {
		csvData.WriteString(fmt.Sprintf("%.6f,%.6f,%.3f,%s,%s,%s,%s,\"%s\"\n",
			coord.X, coord.Y, coord.Distance, coord.CircleType,
			coord.Timestamp.Format("2006-01-02T15:04:05.000Z"),
			coord.AthleteID, coord.CompetitionRound, coord.EDMReading))
	}

	log.Printf("Exported %d coordinates as CSV", len(coordinates))
	return csvData.String(), nil
}

func (a *App) ExportHeatmapData(circleType string, gridSize float64) (map[string]interface{}, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	var coordinates []ThrowCoordinate
	for _, coord := range a.throwCoordinates {
		if coord.CircleType == circleType {
			coordinates = append(coordinates, coord)
		}
	}

	if len(coordinates) == 0 {
		return nil, fmt.Errorf("no coordinates found for %s", circleType)
	}

	// Find bounds
	minX, maxX := coordinates[0].X, coordinates[0].X
	minY, maxY := coordinates[0].Y, coordinates[0].Y

	for _, coord := range coordinates {
		if coord.X < minX {
			minX = coord.X
		}
		if coord.X > maxX {
			maxX = coord.X
		}
		if coord.Y < minY {
			minY = coord.Y
		}
		if coord.Y > maxY {
			maxY = coord.Y
		}
	}

	// Create grid
	gridWidth := int(math.Ceil((maxX-minX)/gridSize)) + 1
	gridHeight := int(math.Ceil((maxY-minY)/gridSize)) + 1

	heatmapGrid := make([][]int, gridHeight)
	for i := range heatmapGrid {
		heatmapGrid[i] = make([]int, gridWidth)
	}

	// Populate grid
	for _, coord := range coordinates {
		gridX := int((coord.X - minX) / gridSize)
		gridY := int((coord.Y - minY) / gridSize)

		if gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight {
			heatmapGrid[gridY][gridX]++
		}
	}

	result := map[string]interface{}{
		"circleType": circleType,
		"gridSize":   gridSize,
		"bounds": map[string]float64{
			"minX": minX,
			"maxX": maxX,
			"minY": minY,
			"maxY": maxY,
		},
		"gridWidth":   gridWidth,
		"gridHeight":  gridHeight,
		"heatmap":     heatmapGrid,
		"totalThrows": len(coordinates),
		"coordinates": coordinates, // Include raw coordinates for overlay
	}

	log.Printf("Generated heatmap for %s: %dx%d grid with %d throws",
		circleType, gridWidth, gridHeight, len(coordinates))

	return result, nil
}

// Clear stored coordinates (useful for testing or new competitions)
func (a *App) ClearThrowCoordinates() error {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	count := len(a.throwCoordinates)
	a.throwCoordinates = make([]ThrowCoordinate, 0)

	// End current session
	if a.currentSession != nil {
		now := time.Now().UTC()
		a.currentSession.EndTime = &now
		a.currentSession = nil
	}

	log.Printf("Cleared %d stored throw coordinates", count)
	return nil
}

// Get current session info
func (a *App) GetCurrentSession() (*ThrowSession, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	if a.currentSession == nil {
		return nil, fmt.Errorf("no active session")
	}

	// Return copy
	session := *a.currentSession
	return &session, nil
}

// Get statistics for all throws of a circle type
func (a *App) GetThrowStatistics(circleType string) (*SessionStatistics, error) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	var coordinates []ThrowCoordinate
	for _, coord := range a.throwCoordinates {
		if coord.CircleType == circleType {
			coordinates = append(coordinates, coord)
		}
	}

	if len(coordinates) == 0 {
		return nil, fmt.Errorf("no throws found for %s", circleType)
	}

	stats := &SessionStatistics{
		TotalThrows: len(coordinates),
	}

	var sumX, sumY, sumDistance float64
	var maxDist, minDist float64 = coordinates[0].Distance, coordinates[0].Distance

	for _, coord := range coordinates {
		sumX += coord.X
		sumY += coord.Y
		sumDistance += coord.Distance

		if coord.Distance > maxDist {
			maxDist = coord.Distance
		}
		if coord.Distance < minDist {
			minDist = coord.Distance
		}
	}

	stats.AverageX = sumX / float64(len(coordinates))
	stats.AverageY = sumY / float64(len(coordinates))
	stats.AverageDistance = sumDistance / float64(len(coordinates))
	stats.MaxDistance = maxDist
	stats.MinDistance = minDist

	// Calculate spread radius
	var sumSquaredDist float64
	for _, coord := range coordinates {
		dx := coord.X - stats.AverageX
		dy := coord.Y - stats.AverageY
		sumSquaredDist += dx*dx + dy*dy
	}
	stats.SpreadRadius = math.Sqrt(sumSquaredDist / float64(len(coordinates)))

	return stats, nil
}

// --- API Communication Functions (Client Mode) ---

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

// --- Wind & Scoreboard Specific Functions ---
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

// --- Wails Bindable Functions ---
func (a *App) SetDemoMode(enabled bool) {
	a.stateMux.Lock()
	a.demoMode = enabled
	// Reset demo simulations when demo mode changes
	if enabled {
		a.demoSim = make(map[string]*DemoSimulation)
	}
	a.stateMux.Unlock()
}

func (a *App) ListSerialPorts() ([]string, error) {
	return serial.GetPortsList()
}

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

	// Reset demo simulation when calibration changes
	if a.demoMode {
		delete(a.demoSim, devType)
	}

	return nil
}

func (a *App) ResetCalibration(devType string) error {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()
	delete(a.CalibrationStore, devType)

	// Reset demo simulation
	if a.demoMode {
		delete(a.demoSim, devType)
	}

	return nil
}

// --- Debug Functions ---
func (a *App) DebugCalibrationData(devType string) {
	a.stateMux.Lock()
	defer a.stateMux.Unlock()

	cal, exists := a.CalibrationStore[devType]
	if !exists {
		log.Printf("DEBUG: No calibration data found for %s", devType)
		return
	}

	log.Printf("DEBUG: Calibration data for %s:", devType)
	log.Printf("  Selected Circle Type: %s", cal.SelectedCircleType)
	log.Printf("  Target Radius: %.4fm", cal.TargetRadius)
	log.Printf("  Centre Set: %t", cal.IsCentreSet)
	log.Printf("  Station Coordinates: X=%.4fm, Y=%.4fm", cal.StationCoordinates.X, cal.StationCoordinates.Y)
	if cal.EdgeVerificationResult != nil {
		log.Printf("  Edge Verification: %.1fmm difference, in tolerance: %t",
			cal.EdgeVerificationResult.DifferenceMm, cal.EdgeVerificationResult.IsInTolerance)
	}

	if a.demoMode {
		sim, exists := a.demoSim[devType]
		if exists {
			log.Printf("  Demo Station: X=%.4fm, Y=%.4fm", sim.stationX, sim.stationY)
		}
	}
}

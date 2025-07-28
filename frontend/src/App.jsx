import React, { useState, useEffect } from 'react';
import {
    ChevronLeft, ChevronRight, Wind, Speaker, Target, Power, PowerOff, Compass, CheckCircle, XCircle, Ruler, Wifi, Usb, RotateCcw, Server, Tv, Download, Play, Settings, Users, Edit, Trophy, UserCheck
} from 'lucide-react';

// Wails Go Function Imports
import {
    // Standalone & Shared Functions
    ListSerialPorts, ConnectSerialDevice, ConnectNetworkDevice, DisconnectDevice, SetDemoMode,
    GetCalibration, SaveCalibration, SetCircleCentre, VerifyCircleEdge, MeasureThrow, ResetCalibration, MeasureWind, SendToScoreboard,
    // Event Mode API Functions
    SetServerAddress, FetchEvents, FetchEventDetails, PostResult
} from '../wailsjs/go/main/App';

// --- UI Components ---
const Card = ({ children, onClick, className = '', disabled = false, selected = false }) => ( <button onClick={onClick} disabled={disabled} className={`border-2 ${selected ? 'border-blue-500 ring-2 ring-blue-400' : 'border-gray-300 hover:border-blue-400'} bg-white text-gray-800 font-semibold p-4 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 ease-in-out flex flex-col items-center justify-center text-center ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>{children}</button> );
const Button = ({ children, onClick, variant = 'primary', className = '', icon: Icon, disabled = false, size = 'md' }) => {
    const baseStyle = 'rounded-lg font-semibold shadow-md hover:shadow-lg transition-all duration-200 ease-in-out flex items-center justify-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 active:scale-95';
    const sizeStyle = size === 'sm' ? 'px-3 py-1.5 text-sm' : (size === 'lg' ? 'px-8 py-4 text-xl' : 'px-6 py-3 text-lg');
    let variantStyle = '';
    switch (variant) {
        case 'secondary': variantStyle = 'bg-gray-200 hover:bg-gray-300 text-gray-800 focus:ring-gray-400'; break;
        case 'danger': variantStyle = 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500'; break;
        case 'success': variantStyle = 'bg-green-500 hover:bg-green-600 text-white focus:ring-green-400'; break;
        default: variantStyle = 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500';
    }
    return ( <button onClick={onClick} className={`${baseStyle} ${variantStyle} ${sizeStyle} ${className}`} disabled={disabled}> {Icon && <Icon size={size === 'sm' ? 16 : (size === 'lg' ? 24 : 20)} className={children ? "mr-2" : ""} />} {children && <span>{children}</span>} </button> );
};
const Select = ({ label, value, onChange, options, className = '', disabled = false }) => (
    <div className={`mb-2 ${className}`}>
        {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
        <select value={value} onChange={onChange} disabled={disabled} className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-200">
            <option value="">-- Select --</option>
            {options.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
        </select>
    </div>
);
const InputField = ({ label, type = "text", value, onChange, placeholder, className = '', disabled = false }) => (
    <div className={`mb-2 ${className}`}>
        {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
        <input type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} className="w-full px-3 py-2 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-200" />
    </div>
);
const ToggleSwitch = ({ label, enabled, onToggle, disabled = false }) => ( <div className="flex items-center justify-between"> <span className="text-base font-medium text-gray-700">{label}</span> <button onClick={() => onToggle(!enabled)} disabled={disabled} className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${enabled ? 'bg-blue-600' : 'bg-gray-300'} ${disabled ? 'opacity-50' : ''}`}> <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-300 ${enabled ? 'translate-x-6' : 'translate-x-1'}`} /> </button> </div> );
const BottomNavBar = ({ children }) => ( <div className="fixed bottom-0 left-0 right-0 bg-gray-100 p-3 border-t border-gray-300 shadow-top z-30 flex justify-between items-center">{children}</div> );

// --- Helper Functions ---
const parseMark = (mark) => {
    if (!mark || typeof mark !== 'string') return -1;
    const lowerMark = mark.toLowerCase();
    if (lowerMark === 'foul' || lowerMark === 'pass' || lowerMark === '') return -1;
    return parseFloat(mark);
};

const getBestPerformance = (series) => {
    let bestMark = -1;
    let windForBest = null;
    (series || []).forEach(p => {
        const numericMark = parseMark(p.mark);
        if (p.valid && numericMark > bestMark) {
            bestMark = numericMark;
            windForBest = p.wind;
        }
    });
    return {
        bestMark: bestMark > -1 ? bestMark.toFixed(2) : '---',
        windForBest: windForBest
    };
};

// --- Screens ---

const ModeSelectionScreen = ({ onNavigate, setAppState }) => {
    const [serverIp, setServerIp] = useState("127.0.0.1");
    const [serverPort, setServerPort] = useState("8080");
    const [events, setEvents] = useState([]);
    const [selectedEventId, setSelectedEventId] = useState("");
    const [status, setStatus] = useState("Enter server details and fetch events.");
    const [isLoading, setIsLoading] = useState(false);

    const handleFetchEvents = async () => {
        setIsLoading(true);
        setStatus("Fetching events...");
        try {
            const fetchedEvents = await FetchEvents(serverIp, parseInt(serverPort, 10));
            setEvents(fetchedEvents || []);
            setStatus(fetchedEvents.length > 0 ? "Select an event or choose Stand Alone Mode." : "No events found on server.");
            await SetServerAddress(serverIp, parseInt(serverPort, 10));
        } catch (error) {
            setStatus(`Error fetching events: ${error}`);
        }
        setIsLoading(false);
    };

    const handleSelectEvent = async () => {
        if (!selectedEventId) { setStatus("Please select an event."); return; }
        setIsLoading(true);
        setStatus(`Loading details for ${selectedEventId}...`);
        try {
            const eventDetails = await FetchEventDetails(serverIp, parseInt(serverPort, 10), selectedEventId);
            const performances = {};
            const checkIns = {};
            eventDetails.athletes.forEach(athlete => {
                checkIns[athlete.bib] = false; // Default to not checked-in
                performances[athlete.bib] = Array.from({ length: eventDetails.rules.attempts }, (_, i) => ({
                    attempt: i + 1, mark: "", unit: "m", wind: null, valid: true
                }));
            });
            setAppState(prev => ({ ...prev, operatingMode: 'event', eventData: eventDetails, eventType: eventDetails.type, athletePerformances: performances, athleteCheckIns: checkIns }));
            onNavigate('EVENT_SETTINGS');
        } catch (error) {
            setStatus(`Error loading event details: ${error}`);
        }
        setIsLoading(false);
    };

    const handleStandalone = () => {
        setAppState(prev => ({ ...prev, operatingMode: 'standalone' }));
        onNavigate('SELECT_EVENT_TYPE');
    };

    return (
        <div className="p-4 md:p-6 max-w-full mx-auto flex flex-col h-full">
            <h1 className="text-3xl font-bold text-center mb-4 text-gray-800">Select Operating Mode</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-grow">
                <div className="p-4 bg-white border rounded-lg shadow-sm">
                    <h2 className="text-xl font-semibold mb-2 flex items-center"><Server className="mr-2"/>Event Mode (Connect to Server)</h2>
                    <div className="grid grid-cols-2 gap-2">
                        <InputField label="Server IP" value={serverIp} onChange={e => setServerIp(e.target.value)} />
                        <InputField label="Server Port" value={serverPort} onChange={e => setServerPort(e.target.value)} />
                    </div>
                    <Button onClick={handleFetchEvents} icon={Download} className="w-full my-2" disabled={isLoading}>{isLoading ? 'Fetching...' : 'Fetch Events'}</Button>
                    {events.length > 0 && (
                        <>
                            <Select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)} options={events.map(e => ({ value: e.id, label: e.name }))} />
                            <Button onClick={handleSelectEvent} icon={Play} className="w-full mt-2" disabled={!selectedEventId || isLoading}>Start Selected Event</Button>
                        </>
                    )}
                </div>
                <div className="p-4 bg-white border rounded-lg shadow-sm flex flex-col items-center justify-center">
                     <h2 className="text-xl font-semibold mb-4 flex items-center"><Tv className="mr-2"/>Stand Alone Mode</h2>
                    <Button onClick={handleStandalone} size="lg" className="w-full">Use Stand Alone Mode</Button>
                </div>
            </div>
            <div className="mt-4 p-2 bg-gray-200 rounded-md text-center text-gray-700 text-sm truncate">Status: {status}</div>
        </div>
    );
};

const EventSettingsScreen = ({ onNavigate, appState, setAppState }) => {
    const [rules, setRules] = useState(appState.eventData.rules);

    const handleRuleChange = (field, value) => {
        const newRules = { ...rules, [field]: value };
        setRules(newRules);
        setAppState(prev => ({ ...prev, eventData: { ...prev.eventData, rules: newRules } }));
    };

    return (
        <div className="p-4 md:p-6 max-w-md mx-auto">
            <h1 className="text-2xl font-bold text-center">Event Settings</h1>
            <p className="text-center my-2 text-gray-600">{appState.eventData?.name}</p>
            <div className="mt-4 space-y-4">
                <InputField label="Number of Attempts" type="number" min="1" max="6" value={rules.attempts} onChange={e => handleRuleChange('attempts', parseInt(e.target.value))} />
                <ToggleSwitch label="Enable Cut" enabled={rules.cutEnabled} onToggle={val => handleRuleChange('cutEnabled', val)} />
                {rules.cutEnabled && (
                    <>
                        <InputField label="Qualifiers for Final" type="number" min="1" value={rules.cutQualifiers} onChange={e => handleRuleChange('cutQualifiers', parseInt(e.target.value))} />
                        <ToggleSwitch label="Re-order after Cut" enabled={rules.reorderAfterCut} onToggle={val => handleRuleChange('reorderAfterCut', val)} />
                    </>
                )}
            </div>
            <BottomNavBar>
                 <Button onClick={() => onNavigate('MODE_SELECTION')} variant="secondary" icon={ChevronLeft} size="lg">Back</Button>
                <Button onClick={() => onNavigate('SELECT_DEVICES')} icon={ChevronRight} size="lg">Next</Button>
            </BottomNavBar>
        </div>
    );
};

// Simulate EDM measurements for demo mode
const simulateEDMReading = async (operationType = 'measure', demoMode = false) => {
    if (!demoMode) {
        throw new Error('Demo mode is not enabled');
    }
    
    // Add realistic delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    switch (operationType) {
        case 'setCentre':
            return {
                isCentreSet: true,
                stationCoordinates: { 
                    x: 100.0 + (Math.random() - 0.5) * 2, 
                    y: 100.0 + (Math.random() - 0.5) * 2 
                },
                timestamp: new Date().toISOString()
            };
            
        case 'verifyEdge':
            const targetRadius = 1.250; // Assume discus for demo
            const actualDistance = targetRadius + (Math.random() - 0.5) * 0.01; // ±5mm variation
            const differenceMm = (actualDistance - targetRadius) * 1000;
            const toleranceAppliedMm = 5.0; // 5mm tolerance
            
            return {
                edgeVerificationResult: {
                    expectedDistanceM: targetRadius,
                    actualDistanceM: actualDistance,
                    differenceMm: differenceMm,
                    toleranceAppliedMm: toleranceAppliedMm,
                    isInTolerance: Math.abs(differenceMm) <= toleranceAppliedMm
                }
            };
            
        case 'measure':
        default:
            // Generate realistic throw distance (15-85m range)
            const distance = 15 + Math.random() * 70;
            return `${distance.toFixed(2)} m`;
    }
};

// Simulate wind measurements for demo mode
const simulateWindReading = async (demoMode = false) => {
    if (!demoMode) {
        throw new Error('Demo mode is not enabled');
    }
    
    // Add realistic delay
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second measurement period
    
    // Generate realistic wind reading (-3.0 to +3.0 m/s)
    const windSpeed = (Math.random() - 0.5) * 6;
    return `${windSpeed.toFixed(1)} m/s`;
};

const AthleteListScreen = ({ onNavigate, appState, setAppState }) => {
    const { eventData, athletePerformances, athleteCheckIns } = appState;
    const [showAll, setShowAll] = useState(true);

    const checkedInAthletes = eventData.athletes.filter(a => athleteCheckIns[a.bib] === true);
    const rankedAthletes = calculateAthleteRankings(checkedInAthletes, athletePerformances);
    
    // Apply filter for showing all or just checked in
    const filteredAthletes = showAll ? 
        eventData.athletes.map(athlete => {
            const rankedAthlete = rankedAthletes.find(ra => ra.bib === athlete.bib);
            return {
                ...athlete,
                checkedIn: athleteCheckIns[athlete.bib] === true,
                position: rankedAthlete ? rankedAthlete.position : '-',
                bestMark: rankedAthlete ? (rankedAthlete.bestMark > 0 ? rankedAthlete.bestMark.toFixed(2) : '---') : '---'
            };
        }) :
        rankedAthletes.map(athlete => ({
            ...athlete,
            checkedIn: true,
            bestMark: athlete.bestMark > 0 ? athlete.bestMark.toFixed(2) : '---'
        }));

    const handleCheckIn = (bib) => {
        setAppState(prev => ({
            ...prev,
            athleteCheckIns: { ...prev.athleteCheckIns, [bib]: !prev.athleteCheckIns[bib] }
        }));
    };

    const handleSelectAthlete = (bib) => {
        setAppState(prev => ({ ...prev, selectedAthleteBib: bib }));
        onNavigate('EVENT_MEASUREMENT');
    };

    const handleStartCompetition = () => {
        // Find the first checked-in athlete in original order
        const checkedInAthletes = eventData.athletes.filter(athlete => athleteCheckIns[athlete.bib] === true);
        const firstCheckedInAthlete = checkedInAthletes[0];
        
        if (firstCheckedInAthlete) {
            setAppState(prev => ({ ...prev, selectedAthleteBib: firstCheckedInAthlete.bib }));
            onNavigate('EVENT_MEASUREMENT');
        } else {
            // Show error if no athletes are checked in
            alert('Please check in at least one athlete before starting the competition.');
        }
    };

    return (
        <div className="p-2 md:p-4 max-w-full mx-auto" style={{ paddingBottom: '80px', maxHeight: 'calc(100vh - 60px)', overflowY: 'auto' }}>
            <h1 className="text-2xl font-bold text-center">{eventData.name}</h1>
            <div className="flex justify-between items-center my-4">
                <p className="text-gray-600">Leaderboard</p>
                <ToggleSwitch label="Show All" enabled={showAll} onToggle={setShowAll} />
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white">
                    <thead className="bg-gray-200">
                        <tr>
                            <th className="py-2 px-3 text-left">Present</th>
                            <th className="py-2 px-3 text-left">Position</th>
                            <th className="py-2 px-3 text-left">Bib</th>
                            <th className="py-2 px-3 text-left text-lg">Name</th>
                            <th className="py-2 px-3 text-left">Club</th>
                            <th className="py-2 px-3 text-left">Best</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAthletes.map(athlete => (
                            <tr key={athlete.bib} className="border-b hover:bg-gray-100 cursor-pointer">
                                <td className="py-2 px-3 text-center">
                                     <Button onClick={(e) => { e.stopPropagation(); handleCheckIn(athlete.bib); }} variant={athlete.checkedIn ? 'success' : 'secondary'} size="sm">
                                        {athlete.checkedIn ? 'Present' : 'Check In'}
                                    </Button>
                                </td>
                                <td className="py-2 px-3 font-bold text-lg" onClick={() => handleSelectAthlete(athlete.bib)}>{athlete.position}</td>
                                <td className="py-2 px-3 text-lg" onClick={() => handleSelectAthlete(athlete.bib)}>{athlete.bib}</td>
                                <td className="py-2 px-3 text-lg" onClick={() => handleSelectAthlete(athlete.bib)}>{athlete.name}</td>
                                <td className="py-2 px-3 text-lg" onClick={() => handleSelectAthlete(athlete.bib)}>{athlete.club}</td>
                                <td className="py-2 px-3 font-semibold text-lg" onClick={() => handleSelectAthlete(athlete.bib)}>{athlete.bestMark}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <BottomNavBar>
                <Button onClick={() => onNavigate('EVENT_SETTINGS')} variant="secondary" icon={ChevronLeft} size="lg">Back</Button>
                <Button onClick={handleStartCompetition} variant="success" icon={Play} size="lg">Start Competition</Button>
            </BottomNavBar>
        </div>
    );
};
// Helper function to calculate athlete ranking using World Athletics rules
const calculateAthleteRankings = (checkedInAthletes, athletePerformances) => {
    return checkedInAthletes
        .map(athlete => {
            const performances = athletePerformances[athlete.bib] || [];
            const validMarks = performances
                .filter(p => p.valid && p.mark && p.mark !== "FOUL" && p.mark !== "")
                .map(p => parseMark(p.mark))
                .filter(mark => mark > 0)
                .sort((a, b) => b - a); // Sort descending

            const bestMark = validMarks.length > 0 ? validMarks[0] : -1;
            const secondBestMark = validMarks.length > 1 ? validMarks[1] : -1;
            const thirdBestMark = validMarks.length > 2 ? validMarks[2] : -1;

            return {
                ...athlete,
                bestMark,
                secondBestMark,
                thirdBestMark,
                validMarks,
                attemptCount: performances.filter(p => p.mark && p.mark !== "").length
            };
        })
        .sort((a, b) => {
            // World Athletics ranking rules
            // 1. Best mark
            if (a.bestMark !== b.bestMark) {
                return b.bestMark - a.bestMark;
            }
            
            // 2. If best marks are equal, compare second best
            if (a.secondBestMark !== b.secondBestMark) {
                return b.secondBestMark - a.secondBestMark;
            }
            
            // 3. If second best marks are equal, compare third best
            if (a.thirdBestMark !== b.thirdBestMark) {
                return b.thirdBestMark - a.thirdBestMark;
            }
            
            // 4. If all marks are equal, athlete with fewer attempts ranks higher
            if (a.attemptCount !== b.attemptCount) {
                return a.attemptCount - b.attemptCount;
            }
            
            // 5. If everything is equal, maintain original order (by bib)
            return parseInt(a.bib) - parseInt(b.bib);
        })
        .map((athlete, index) => ({
            ...athlete,
            position: index + 1
        }));
};
// Helper function to get current round number based on all athletes' progress
const getCurrentRound = (checkedInAthletes, athletePerformances) => {
    let currentRound = 1;
    const maxAttempts = 6; // Assume max 6 attempts
    
    for (let round = 1; round <= maxAttempts; round++) {
        const allAthletesCompletedRound = checkedInAthletes.every(athlete => {
            const perf = athletePerformances[athlete.bib];
            return perf && perf[round - 1] && perf[round - 1].mark !== "";
        });
        
        if (!allAthletesCompletedRound) {
            currentRound = round;
            break;
        }
        
        if (round === maxAttempts && allAthletesCompletedRound) {
            currentRound = maxAttempts + 1; // All rounds complete
            break;
        }
    }
    
    return currentRound;
};

// Helper function to check if competition is complete
const isCompetitionComplete = (checkedInAthletes, athletePerformances, maxAttempts) => {
    return checkedInAthletes.every(athlete => {
        const perf = athletePerformances[athlete.bib];
        if (!perf) return false;
        
        // Check if athlete has completed all attempts or is retired
        const completedAllAttempts = perf.every(p => p.mark !== "");
        const isRetired = perf.some(p => p.mark === "RETIRED");
        
        return completedAllAttempts || isRetired;
    });
};
const CutResultsScreen = ({ onNavigate, appState, setAppState }) => {
    const { eventData, athletePerformances, athleteCheckIns } = appState;
    const checkedInAthletes = eventData.athletes.filter(a => athleteCheckIns[a.bib] === true);
    const rankedAthletes = calculateAthleteRankings(checkedInAthletes, athletePerformances);
    
    const qualifiers = eventData.rules.cutQualifiers || 8;
    const qualifiedAthletes = rankedAthletes.slice(0, qualifiers);
    const eliminatedAthletes = rankedAthletes.slice(qualifiers);

    const handleContinueToFinals = () => {
        // Set the first qualified athlete as selected and ensure they're set for round 4
        if (qualifiedAthletes.length > 0) {
            setAppState(prev => ({ 
                ...prev, 
                selectedAthleteBib: qualifiedAthletes[0].bib,
                // Mark that we're now in finals
                inFinals: true 
            }));
            onNavigate('EVENT_MEASUREMENT');
        }
    };

    const formatMark = (mark) => {
        return mark > 0 ? mark.toFixed(2) + 'm' : '---';
    };

    return (
        <div className="p-4 max-w-full mx-auto" style={{ paddingBottom: '80px', maxHeight: 'calc(100vh - 60px)', overflowY: 'auto' }}>
            <h1 className="text-2xl font-bold text-center mb-2">{eventData.name}</h1>
            <h2 className="text-xl font-semibold text-center mb-4 text-blue-600">Cut Results - After Round 3</h2>
            
            <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded-lg text-center">
                <p className="text-yellow-800 font-semibold">
                    🎯 Cut Applied: Top {qualifiers} athletes advance to final rounds (4-{eventData.rules.attempts})
                </p>
            </div>
            
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="text-lg font-bold text-green-700 mb-2">✅ Qualified for Finals ({qualifiedAthletes.length}/{qualifiers})</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white rounded">
                        <thead className="bg-green-100">
                            <tr>
                                <th className="py-2 px-3 text-left">Pos</th>
                                <th className="py-2 px-3 text-left">Bib</th>
                                <th className="py-2 px-3 text-left">Name</th>
                                <th className="py-2 px-3 text-left">Club</th>
                                <th className="py-2 px-3 text-left">Best</th>
                                <th className="py-2 px-3 text-left">2nd Best</th>
                                <th className="py-2 px-3 text-left">3rd Best</th>
                            </tr>
                        </thead>
                        <tbody>
                            {qualifiedAthletes.map(athlete => (
                                <tr key={athlete.bib} className="border-b hover:bg-green-50">
                                    <td className="py-2 px-3 font-bold text-lg">{athlete.position}</td>
                                    <td className="py-2 px-3 font-semibold">{athlete.bib}</td>
                                    <td className="py-2 px-3 font-semibold">{athlete.name}</td>
                                    <td className="py-2 px-3">{athlete.club}</td>
                                    <td className="py-2 px-3 font-bold text-green-700">{formatMark(athlete.bestMark)}</td>
                                    <td className="py-2 px-3">{formatMark(athlete.secondBestMark)}</td>
                                    <td className="py-2 px-3">{formatMark(athlete.thirdBestMark)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {eliminatedAthletes.length > 0 && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <h3 className="text-lg font-bold text-red-700 mb-2">❌ Eliminated ({eliminatedAthletes.length})</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-white rounded">
                            <thead className="bg-red-100">
                                <tr>
                                    <th className="py-2 px-3 text-left">Pos</th>
                                    <th className="py-2 px-3 text-left">Bib</th>
                                    <th className="py-2 px-3 text-left">Name</th>
                                    <th className="py-2 px-3 text-left">Club</th>
                                    <th className="py-2 px-3 text-left">Best</th>
                                    <th className="py-2 px-3 text-left">2nd Best</th>
                                    <th className="py-2 px-3 text-left">3rd Best</th>
                                </tr>
                            </thead>
                            <tbody>
                                {eliminatedAthletes.map(athlete => (
                                    <tr key={athlete.bib} className="border-b hover:bg-red-50">
                                        <td className="py-2 px-3 font-bold text-lg">{athlete.position}</td>
                                        <td className="py-2 px-3">{athlete.bib}</td>
                                        <td className="py-2 px-3">{athlete.name}</td>
                                        <td className="py-2 px-3">{athlete.club}</td>
                                        <td className="py-2 px-3 font-bold">{formatMark(athlete.bestMark)}</td>
                                        <td className="py-2 px-3">{formatMark(athlete.secondBestMark)}</td>
                                        <td className="py-2 px-3">{formatMark(athlete.thirdBestMark)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="text-center p-4 bg-gray-100 rounded-lg">
                <p className="text-gray-700 mb-2">
                    <strong>World Athletics Ranking Rules Applied:</strong>
                </p>
                <p className="text-sm text-gray-600">
                    1st: Best mark → 2nd: Second best mark → 3rd: Third best mark → 4th: Fewest attempts
                </p>
            </div>

            <BottomNavBar>
                <Button onClick={() => onNavigate('ATHLETE_LIST')} variant="secondary" icon={ChevronLeft} size="lg">Back to List</Button>
                <Button onClick={handleContinueToFinals} variant="success" icon={ChevronRight} size="lg">Continue to Finals (Round 4)</Button>
            </BottomNavBar>
        </div>
    );
};

const EventMeasurementScreen = ({ onNavigate, appState, setAppState }) => {
    const { eventData, selectedAthleteBib, athletePerformances, athleteCheckIns, serverAddress } = appState;
    const athlete = eventData.athletes.find(a => a.bib === selectedAthleteBib);
    const performances = athletePerformances[selectedAthleteBib];
    const [status, setStatus] = useState("Ready");
    const [isMeasuring, setIsMeasuring] = useState(false);
    const [currentAttempt, setCurrentAttempt] = useState(0);
    const [currentMeasurement, setCurrentMeasurement] = useState("");
    const [cutShown, setCutShown] = useState(appState.cutShown || false);

    // Get only checked-in athletes for navigation
    const checkedInAthletes = eventData.athletes;

    const { bestMark, windForBest } = getBestPerformance(performances);

    // Helper function to determine current round and next athlete
const getNextAthleteAndRound = () => {
    const maxAttempts = eventData.rules.attempts;
    const cutAfter = eventData.rules.cutEnabled ? 3 : maxAttempts; // Cut after round 3
    
    // Check completion status for each round
    const roundStatus = {};
    for (let round = 1; round <= maxAttempts; round++) {
        roundStatus[round] = checkedInAthletes.every(athlete => {
            const perf = athletePerformances[athlete.bib];
            return perf && perf[round - 1] && perf[round - 1].mark !== "";
        });
    }
    
    // Find current round (first incomplete round)
    let currentRound = 1;
    for (let round = 1; round <= maxAttempts; round++) {
        if (!roundStatus[round]) {
            currentRound = round;
            break;
        }
        if (round === maxAttempts && roundStatus[round]) {
            currentRound = maxAttempts; // All rounds complete
            break;
        }
    }
    
    // Special handling for cut after round 3
    if (eventData.rules.cutEnabled && roundStatus[3] && currentRound > 3) {
        // Round 3 is complete, should show cut results
        return {
            shouldShowCut: true,
            currentRound: 3,
            nextRound: 4
        };
    }
    
    // If we're past the cut point, filter athletes for final rounds
    let athletesForThisRound = checkedInAthletes;
    if (currentRound > cutAfter && eventData.rules.cutEnabled) {
        // Get athletes qualified for final rounds (top N based on performance so far)
        const qualifiers = eventData.rules.cutQualifiers || 8;
        const rankedAthletes = calculateAthleteRankings(checkedInAthletes, athletePerformances);
        athletesForThisRound = rankedAthletes.slice(0, qualifiers);
    }
    
    // Find next athlete in current round who needs an attempt
    const currentAthleteIndex = athletesForThisRound.findIndex(a => a.bib === selectedAthleteBib);
    
    // Check if current athlete has completed current round
    const currentAthletePerf = athletePerformances[selectedAthleteBib];
    const hasCompletedCurrentRound = currentAthletePerf && 
        currentAthletePerf[currentRound - 1] && 
        currentAthletePerf[currentRound - 1].mark !== "";
    
    if (hasCompletedCurrentRound) {
        // Move to next athlete in current round
        const nextIndex = (currentAthleteIndex + 1) % athletesForThisRound.length;
        const nextAthlete = athletesForThisRound[nextIndex];
        
        // Check if next athlete also completed current round
        const nextAthletePerf = athletePerformances[nextAthlete.bib];
        const nextAthleteCompletedRound = nextAthletePerf && 
            nextAthletePerf[currentRound - 1] && 
            nextAthletePerf[currentRound - 1].mark !== "";
        
        if (nextAthleteCompletedRound && roundStatus[currentRound]) {
            // Round is complete
            if (currentRound === 3 && eventData.rules.cutEnabled) {
                return {
                    shouldShowCut: true,
                    currentRound: 3,
                    nextRound: 4
                };
            } else {
                // Move to next round, first athlete
                return {
                    nextAthlete: athletesForThisRound[0],
                    newRound: currentRound + 1,
                    roundComplete: true
                };
            }
        } else {
            return {
                nextAthlete: nextAthlete,
                newRound: currentRound,
                roundComplete: false
            };
        }
    } else {
        // Current athlete hasn't completed current round
        return {
            nextAthlete: athlete,
            newRound: currentRound,
            roundComplete: false
        };
    }
};

    // Update current attempt based on athlete's progress
React.useEffect(() => {
    if (performances) {
        // Find the first empty attempt
        const nextAttemptIndex = performances.findIndex(p => !p.mark || p.mark === "");
        setCurrentAttempt(nextAttemptIndex !== -1 ? nextAttemptIndex : performances.length - 1);
    }
}, [selectedAthleteBib, performances]);

// Add this useEffect to check for cut conditions when performances change
React.useEffect(() => {
    if (eventData.rules.cutEnabled && performances) {
        // Check if round 3 just completed for all athletes
        const round3Complete = checkedInAthletes.every(athlete => {
            const perf = athletePerformances[athlete.bib];
            return perf && perf[2] && perf[2].mark !== "";
        });
        
        if (round3Complete) {
            console.log('Round 3 detected as complete for all athletes');
            // Check if current athlete just completed their round 3
            const currentAthleteRound3 = performances[2] && performances[2].mark !== "";
            if (currentAthleteRound3) {
                const currentIndex = checkedInAthletes.findIndex(a => a.bib === selectedAthleteBib);
                const isLastInRound = currentIndex === checkedInAthletes.length - 1;
                
                if (isLastInRound) {
                    console.log('Last athlete completed round 3, should show cut');
                    // Small delay to ensure UI updates
                    setTimeout(() => {
                        onNavigate('CUT_RESULTS');
                    }, 500);
                }
            }
        }
    }
}, [athletePerformances, selectedAthleteBib]);

    const updateAndPost = async (newPerformances) => {
        setAppState(prev => ({ ...prev, athletePerformances: { ...prev.athletePerformances, [selectedAthleteBib]: newPerformances }}));
        if (serverAddress) {
            const [ip, port] = serverAddress.split(':');
            try {
                await PostResult(ip, parseInt(port), {
                    eventId: eventData.id,
                    athleteBib: selectedAthleteBib,
                    series: newPerformances,
                });
                setStatus("Result synced with server.");
            } catch (error) {
                setStatus(`Result cached. Sync error: ${error}`);
            }
        }
    };
    
    const handleSaveAttempt = () => {
        if (!currentMeasurement) return; // Don't save empty measurements
        
        const newPerformances = [...performances];
        newPerformances[currentAttempt].mark = currentMeasurement;
        newPerformances[currentAttempt].valid = true;
        updateAndPost(newPerformances);
        setCurrentMeasurement("");
    };
    
    const handleFoul = () => {
        const newPerformances = [...performances];
        newPerformances[currentAttempt].mark = "FOUL";
        newPerformances[currentAttempt].valid = false;
        updateAndPost(newPerformances);
        setCurrentMeasurement("");
    };

    const handleMeasure = async () => {
        setIsMeasuring(true);
        setStatus('Requesting measurement...');
        try {
            let result;
            if (appState.demoMode) {
                result = await simulateEDMReading('measure', true);
            } else {
                result = await MeasureThrow("edm");
            }
            setCurrentMeasurement(result.replace(" m", ""));
            setStatus(`Measurement received: ${result}`);
        } catch (error) {
            setStatus(`Error: ${error}`);
        }
        setIsMeasuring(false);
    };
    
    // In the handleNextAthlete function, replace the existing function with:
    const handleNextAthlete = () => {
        // Save current attempt if there's a measurement
        if (currentMeasurement) {
            handleSaveAttempt();
            // Wait a moment for the save to complete before checking round status
            setTimeout(() => {
                checkForCutAfterSave();
            }, 100);
            return;
        }
        
        checkForCutAfterSave();
    };
    
    const checkForCutAfterSave = () => {
        // Get next athlete using smart round logic
        const result = getNextAthleteAndRound();
        
        // Check if we should show cut results
        if (result.shouldShowCut) {
            console.log('Round 3 complete, showing cut results');
            onNavigate('CUT_RESULTS');
            return;
        }
        
        if (result.roundComplete) {
            setStatus(`Round ${result.newRound - 1} complete! Starting Round ${result.newRound}`);
        }
        
        setAppState(prev => ({ ...prev, selectedAthleteBib: result.nextAthlete.bib }));
        setCurrentMeasurement(""); // Clear measurement for next athlete
    };

    const handlePreviousAthlete = () => {
        // Save current attempt if there's a measurement
        if (currentMeasurement) {
            handleSaveAttempt();
        }
        
        // Simple previous navigation through checked-in athletes
        const currentIndex = checkedInAthletes.findIndex(a => a.bib === selectedAthleteBib);
        const previousIndex = currentIndex === 0 ? checkedInAthletes.length - 1 : currentIndex - 1;
        setAppState(prev => ({ ...prev, selectedAthleteBib: checkedInAthletes[previousIndex].bib }));
        setCurrentMeasurement(""); // Clear measurement for previous athlete
    };

    // If no athlete is selected or athlete not found, show error
    if (!athlete) {
        return (
            <div className="p-4 text-center">
                <p className="text-red-600">Athlete not found. Please select an athlete from the list.</p>
                <Button onClick={() => onNavigate('ATHLETE_LIST')} variant="secondary" className="mt-4">
                    Back to Athlete List
                </Button>
            </div>
        );
    }

    // Find current athlete position in checked-in athletes
    const currentAthleteIndex = checkedInAthletes.findIndex(a => a.bib === selectedAthleteBib);
    const athletePosition = `${currentAthleteIndex + 1} of ${checkedInAthletes.length}`;

    // Determine current round
    const currentRound = Math.floor(currentAttempt / 1) + 1; // Simplified for now

    return (
        <div className="flex flex-col h-full">
            {/* Compact Athlete Details Header */}
            <div className="bg-blue-50 p-2 border-b border-blue-200 flex-shrink-0">
                <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-4 text-sm">
                        <span><strong>Bib:</strong> {athlete.bib}</span>
                        <span><strong>Name:</strong> {athlete.name}</span>
                        <span><strong>Club:</strong> {athlete.club}</span>
                    </div>
                    <div className="flex items-center space-x-4 text-sm">
                        <span><strong>Best:</strong> {bestMark} m</span>
                        <span><strong>Athlete:</strong> {athletePosition}</span>
                        <span><strong>Round:</strong> {currentRound}</span>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-grow p-4 grid grid-cols-3 gap-4">
                <div className="col-span-1 bg-gray-50 p-3 rounded-lg">
                    <h2 className="text-lg font-bold mb-2">History ({currentAttempt + 1}/{performances.length})</h2>
                    <div className="space-y-2">
                        {performances.map((p, i) => (
                            <div key={i} className={`p-2 rounded cursor-pointer ${currentAttempt === i ? 'bg-blue-200' : 'bg-white hover:bg-gray-100'}`} onClick={() => setCurrentAttempt(i)}>
                                Attempt {i + 1}: <span className="font-semibold">{p.mark || 'Pending...'}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="col-span-1 flex flex-col items-center justify-center bg-gray-50 p-3 rounded-lg">
                    <div className="text-lg font-semibold">ATTEMPT {currentAttempt + 1}/{performances.length}</div>
                    <div className="my-4 p-4 bg-gray-200 rounded-lg text-center w-full">
                        <div className="text-7xl font-bold">{currentMeasurement || "0.00"} m</div>
                    </div>
                    <div className="w-full space-y-2">
                        <Button onClick={handleFoul} variant="danger" size="lg" className="w-full">Foul</Button>
                        <Button onClick={handleMeasure} icon={Target} size="lg" className="w-full" disabled={isMeasuring}>{isMeasuring ? 'Measuring...' : 'Measure'}</Button>
                        <Button onClick={handleSaveAttempt} variant="success" size="lg" className="w-full" disabled={!currentMeasurement}>Save Attempt {currentAttempt + 1}</Button>
                        <Button onClick={() => setCurrentMeasurement("")} variant="secondary" size="sm" className="w-full">Clear Current Input</Button>
                    </div>
                </div>
                <div className="col-span-1 bg-gray-50 p-3 rounded-lg">
                    <h2 className="text-lg font-bold mb-2">Athlete Summary</h2>
                    <div className="space-y-3">
                        <div><div className="text-gray-600">Best Valid Mark:</div><div className="text-2xl font-bold">{bestMark} m</div></div>
                        <div><div className="text-gray-600">Wind for Best:</div><div className="text-2xl font-bold">{windForBest || 'N/A'}</div></div>
                        <div><div className="text-gray-600">Current Attempt:</div><div className="text-2xl font-bold">{currentAttempt + 1} / {performances.length}</div></div>
                        <div><div className="text-gray-600">Checked-in Athletes:</div><div className="text-xl font-bold">{checkedInAthletes.length}</div></div>
                    </div>
                </div>
            </div>

            {/* Status Display */}
            <div className="flex-shrink-0 p-2 bg-gray-200 text-center text-gray-700 text-sm">
                Status: {status}
            </div>

            <BottomNavBar>
                <Button onClick={() => onNavigate('ATHLETE_LIST')} variant="secondary" icon={ChevronLeft} size="lg">Back to List</Button>
                <Button onClick={handlePreviousAthlete} variant="secondary" icon={ChevronLeft} size="lg" disabled={checkedInAthletes.length <= 1}>Previous</Button>
                <Button onClick={handleNextAthlete} icon={ChevronRight} size="lg" disabled={checkedInAthletes.length <= 1}>Next</Button>
            </BottomNavBar>
        </div>
    );
};

// --- Standalone Mode Screens ---
const SelectEventTypeScreen_Standalone = ({ onNavigate, setAppState }) => (
    <div className="p-4 md:p-6 max-w-full mx-auto flex flex-col h-full">
        <h1 className="text-3xl font-bold text-center mb-6 text-gray-800">SELECT EVENT TYPE</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 flex-grow content-start">
            <Card onClick={() => { setAppState(prev => ({ ...prev, eventType: 'Throws' })); onNavigate('SELECT_DEVICES'); }} className="h-56 sm:h-64">
                <Target size={48} className="mb-2 text-blue-600" />
                <span className="text-xl md:text-2xl mt-2.5">Throws</span>
                <p className="text-base text-gray-600 mt-2">Shot, Discus, Hammer, Javelin</p>
            </Card>
            <Card onClick={() => { setAppState(prev => ({ ...prev, eventType: 'Horizontal Jumps' })); onNavigate('SELECT_DEVICES'); }} className="h-56 sm:h-64">
                <Wind size={48} className="mb-2 text-blue-600" />
                <span className="text-xl md:text-2xl mt-2.5">Horizontal Jumps</span>
                <p className="text-base text-gray-600 mt-2">Long Jump, Triple Jump</p>
            </Card>
        </div>
        <BottomNavBar>
            <Button onClick={() => onNavigate('MODE_SELECTION')} variant="secondary" icon={ChevronLeft} size="lg">Back</Button>
        </BottomNavBar>
    </div>
);

const SelectDevicesScreen_Shared = ({ onNavigate, appState, setAppState }) => {
    const [serialPorts, setSerialPorts] = useState([]);
    const [status, setStatus] = useState({});
    
    useEffect(() => {
        ListSerialPorts().then(ports => setSerialPorts(ports.map(p => ({ value: p, label: p })))).catch(console.error);
    }, []);

    const handleToggleDemoMode = (enabled) => {
        setAppState(prev => ({ ...prev, demoMode: enabled }));
        SetDemoMode(enabled);
    };

    const handleNext = () => {
        const isEdmReady = appState.devices.edm?.connected || appState.demoMode;
        if (appState.operatingMode === 'standalone') {
            if (isThrowsEvent(appState.eventType, appState.eventData) && isEdmReady) {
                onNavigate('CALIBRATE_EDM');
            } else {
                onNavigate('STAND_ALONE_MODE');
            }
        } else { // Event Mode
            if (isThrowsEvent(appState.eventType, appState.eventData) && isEdmReady) {
                onNavigate('CALIBRATE_EDM');
            } else {
                onNavigate('ATHLETE_LIST');
            }
        }
    };

    // Helper function to determine if event is a throws event
    const isThrowsEvent = (eventType, eventData) => {
        // Define throws event codes and names
        const throwsEventCodes = ['HT1', 'DT1', 'SP1', 'CT1', 'WT1', 'JT1'];
        const throwsEventNames = [
            'Throws', 'Hammer Throw', 'Shot Put', 'Discus Throw', 
            'Club Throw', 'Weighted Throw', 'Javelin', 'Javelin Throw',
            'Hammer', 'Discus', 'Shot', 'Club'
        ];
        
        // For standalone mode, check exact match
        if (appState.operatingMode === 'standalone') {
            return eventType === 'Throws';
        }
        
        // For event mode, check event codes first
        if (eventType && throwsEventCodes.includes(eventType)) {
            return true;
        }
        
        // Check event data type for codes
        if (eventData && eventData.type && throwsEventCodes.includes(eventData.type)) {
            return true;
        }
        
        // Check event names (fallback)
        if (eventData && eventData.type) {
            const dataTypeLower = eventData.type.toLowerCase();
            if (throwsEventNames.some(throwEvent => dataTypeLower.includes(throwEvent.toLowerCase()))) {
                return true;
            }
        }
        
        if (eventData && eventData.name) {
            const dataNameLower = eventData.name.toLowerCase();
            if (throwsEventNames.some(throwEvent => dataNameLower.includes(throwEvent.toLowerCase()))) {
                return true;
            }
        }
        
        // Fallback to eventType string match
        if (eventType) {
            const eventTypeLower = eventType.toLowerCase();
            if (throwsEventNames.some(throwEvent => eventTypeLower.includes(throwEvent.toLowerCase()))) {
                return true;
            }
        }
        
        return false;
    };

    // Helper function to determine if event is a jumps event
    const isJumpsEvent = (eventType, eventData) => {
        // Define jumps event codes and names
        const jumpsEventCodes = ['LJ1', 'TJ1'];
        const jumpsEventNames = [
            'Horizontal Jumps', 'Long Jump', 'Triple Jump', 'Broad Jump'
        ];
        
        // For standalone mode, check exact match
        if (appState.operatingMode === 'standalone') {
            return eventType === 'Horizontal Jumps';
        }
        
        // For event mode, check event codes first
        if (eventType && jumpsEventCodes.includes(eventType)) {
            return true;
        }
        
        // Check event data type for codes
        if (eventData && eventData.type && jumpsEventCodes.includes(eventData.type)) {
            return true;
        }
        
        // Check event names (fallback)
        if (eventData && eventData.type) {
            const dataTypeLower = eventData.type.toLowerCase();
            if (jumpsEventNames.some(jumpEvent => dataTypeLower.includes(jumpEvent.toLowerCase()))) {
                return true;
            }
        }
        
        if (eventData && eventData.name) {
            const dataNameLower = eventData.name.toLowerCase();
            if (jumpsEventNames.some(jumpEvent => dataNameLower.includes(jumpEvent.toLowerCase()))) {
                return true;
            }
        }
        
        // Fallback to eventType string match
        if (eventType) {
            const eventTypeLower = eventType.toLowerCase();
            if (jumpsEventNames.some(jumpEvent => eventTypeLower.includes(jumpEvent.toLowerCase()))) {
                return true;
            }
        }
        
        return false;
    };

    const DevicePanel = ({ title, deviceType, icon, showCalibrateButton = false }) => {
        // Set different default IPs for different device types
        const getDefaultIP = (type) => {
            switch(type) {
                case 'edm': return '192.168.1.100';
                case 'wind': return '192.168.1.102';
                case 'scoreboard': return '192.168.1.101';
                default: return '192.168.1.100';
            }
        };

        const deviceState = appState.devices[deviceType] || { 
            type: 'serial', 
            port: '', 
            ip: getDefaultIP(deviceType), 
            tcpPort: '10001', 
            connected: false 
        };
        const isConnected = deviceState.connected;
        const [localIp, setLocalIp] = useState(deviceState.ip || getDefaultIP(deviceType));
        const [localPort, setLocalPort] = useState(deviceState.tcpPort || '10001');

        const handleConnectionDetailChange = (field, value) => {
            const newDetails = { ...deviceState, [field]: value };
            setAppState(prev => ({...prev, devices: {...prev.devices, [deviceType]: newDetails}}));
            if (field === 'port' && newDetails.type === 'serial' && value) {
                handleConnect(deviceType, newDetails);
            }
        };
        
        const handleConnect = async (dt, details) => {
            setStatus(prev => ({ ...prev, [dt]: "Connecting..." }));
            try {
                let result;
                if (details.type === 'serial') {
                    if (!details.port) { 
                        setStatus(prev => ({ ...prev, [dt]: "Please select a port." })); 
                        return; 
                    }
                    result = await ConnectSerialDevice(dt, details.port);
                } else {
                    // For network connections, use the current local values
                    if (!localIp || !localPort) { 
                        setStatus(prev => ({ ...prev, [dt]: "Please enter IP address and port." })); 
                        return; 
                    }
                    // Validate IP format
                    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
                    if (!ipRegex.test(localIp)) {
                        setStatus(prev => ({ ...prev, [dt]: "Invalid IP address format." })); 
                        return;
                    }
                    // Validate port number
                    const portNum = parseInt(localPort, 10);
                    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                        setStatus(prev => ({ ...prev, [dt]: "Invalid port number (1-65535)." })); 
                        return;
                    }
                    
                    result = await ConnectNetworkDevice(dt, localIp, portNum);
                    // Update the details with the actual connected values
                    details = { ...details, ip: localIp, tcpPort: localPort };
                }
                setAppState(prev => ({ ...prev, devices: { ...prev.devices, [dt]: { ...details, connected: true } } }));
                setStatus(prev => ({ ...prev, [dt]: result }));
            } catch (error) {
                setStatus(prev => ({ ...prev, [dt]: `Error: ${error}` }));
            }
        };

        const handleDisconnect = async (dt) => {
            setStatus(prev => ({ ...prev, [dt]: "Disconnecting..." }));
            try {
                const result = await DisconnectDevice(dt);
                setAppState(prev => ({ ...prev, devices: { ...prev.devices, [dt]: { ...deviceState, connected: false } } }));
                setStatus(prev => ({ ...prev, [dt]: result }));
            } catch (error) {
                setStatus(prev => ({ ...prev, [dt]: `Error: ${error}` }));
            }
        };

        return (
            <div className="bg-gray-50 p-4 rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-lg font-semibold text-blue-700 mb-2 flex items-center">{icon} {title}</h3>
                <div className="grid grid-cols-2 gap-2 mb-2">
                    <Button size="sm" variant={deviceState.type === 'serial' ? 'primary' : 'secondary'} onClick={() => handleConnectionDetailChange('type', 'serial')} icon={Usb}>Serial</Button>
                    <Button size="sm" variant={deviceState.type === 'network' ? 'primary' : 'secondary'} onClick={() => handleConnectionDetailChange('type', 'network')} icon={Wifi}>Network</Button>
                </div>
                {deviceState.type === 'serial' && (<Select value={deviceState.port || ''} onChange={(e) => handleConnectionDetailChange('port', e.target.value)} options={serialPorts} disabled={isConnected || appState.demoMode} /> )}
                {deviceState.type === 'network' && (
                    <div className="grid grid-cols-2 gap-2">
                        <InputField label="IP Address" value={localIp} onChange={e => setLocalIp(e.target.value)} disabled={isConnected || appState.demoMode} placeholder="192.168.1.100" />
                        <InputField label="Port" value={localPort} onChange={e => setLocalPort(e.target.value)} disabled={isConnected || appState.demoMode} placeholder="10001" />
                    </div>
                )}
                <div className="mt-2"><Button onClick={() => isConnected ? handleDisconnect(deviceType) : handleConnect(deviceType)} variant={isConnected ? 'danger' : 'success'} size="sm" icon={isConnected ? PowerOff : Power} disabled={appState.demoMode} className="w-full">{isConnected ? 'Disconnect' : 'Connect'}</Button></div>
                {showCalibrateButton && (<Button onClick={() => onNavigate('CALIBRATE_EDM')} variant="secondary" icon={Compass} size="sm" className="w-full mt-2" disabled={!isConnected && !appState.demoMode}>Calibrate EDM</Button>)}
                {status[deviceType] && <p className={`mt-2 text-xs ${status[deviceType]?.includes('Error') ? 'text-red-500' : 'text-gray-600'}`}>Status: {status[deviceType]}</p>}
            </div>
        );
    };

    // Determine which devices to show
    const showEDM = isThrowsEvent(appState.eventType, appState.eventData);
    const showWindGauge = isJumpsEvent(appState.eventType, appState.eventData);

    console.log('Device filtering results:', {
        showEDM,
        showWindGauge,
        eventType: appState.eventType,
        eventDataType: appState.eventData?.type,
        eventDataName: appState.eventData?.name,
        isThrowsResult: isThrowsEvent(appState.eventType, appState.eventData),
        isJumpsResult: isJumpsEvent(appState.eventType, appState.eventData)
    });

    return (
        <div className="p-3 md:p-4 max-w-full mx-auto" style={{ paddingBottom: '80px', maxHeight: 'calc(100vh - 60px)', overflowY: 'auto' }}>
            <h1 className="text-2xl font-bold text-center mb-1 text-gray-800">DEVICE SETUP</h1>
            <p className="text-center text-base text-gray-600 mb-4">Connect equipment or use Demo Mode.</p>
            
            <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-3 rounded-md mb-4">
                <ToggleSwitch label="Demo Mode" enabled={appState.demoMode} onToggle={handleToggleDemoMode} />
            </div>
            <div className="space-y-3">
                {/* Show EDM for throws events */}
                {showEDM && (
                    <DevicePanel title="EDM" deviceType="edm" icon={<Target size={20} className="mr-1.5" />} showCalibrateButton={true} />
                )}
                {/* Show Wind Gauge for jumps events */}
                {showWindGauge && (
                    <DevicePanel title="Wind Gauge" deviceType="wind" icon={<Wind size={20} className="mr-1.5" />} />
                )}
                {/* Always show Scoreboard for all event types */}
                <DevicePanel title="Scoreboard" deviceType="scoreboard" icon={<Speaker size={20} className="mr-1.5" />} />
            </div>
            <BottomNavBar>
                <Button onClick={() => onNavigate(appState.operatingMode === 'standalone' ? 'SELECT_EVENT_TYPE' : 'EVENT_SETTINGS')} variant="secondary" icon={ChevronLeft} size="lg">Back</Button>
                <Button onClick={handleNext} icon={ChevronRight} size="lg">Next</Button>
            </BottomNavBar>
        </div>
    );
};

const CalibrateEDMScreen_Standalone = ({ onNavigate, appState, setAppState }) => {
    const [calData, setCalData] = useState(null);
    const [status, setStatus] = useState("Loading calibration data...");
    const [isLoading, setIsLoading] = useState(false);
    const deviceType = "edm";

    const UKA_DEFAULTS = { SHOT: 1.0675, DISCUS: 1.250, HAMMER: 1.0675, JAVELIN_ARC: 8.000 };

    const detectCircleType = (eventData, eventType) => {
        if (!eventData) return 'HAMMER'; // Default to HAMMER if no event data
        
        const eventCode = eventData.id || eventData.type || eventData.name || '';
        const eventName = eventData.name || '';
        const fullText = `${eventCode} ${eventName}`.toLowerCase();
        
        // Check for specific event codes first
        if (eventCode.includes('HT') || fullText.includes('hammer')) return 'HAMMER';
        if (eventCode.includes('DT') || fullText.includes('discus')) return 'DISCUS';
        if (eventCode.includes('SP') || fullText.includes('shot')) return 'SHOT';
        if (eventCode.includes('CT') || fullText.includes('club')) return 'HAMMER'; // Use HAMMER circle for club throw
        if (eventCode.includes('WT') || fullText.includes('weight')) return 'HAMMER'; // Use HAMMER circle for weight throw
        if (eventCode.includes('JT') || fullText.includes('javelin')) return 'JAVELIN_ARC';
        
        // Fallback to event type detection
        if (eventType === 'Throws') return 'HAMMER'; // Default for standalone throws
        
        return 'HAMMER'; // Ultimate fallback
    };

    const fetchCal = () => {
        setIsLoading(true);
        setStatus("Loading calibration data...");
        
        // Auto-detect circle type based on event data
        const detectedCircleType = detectCircleType(appState.eventData, appState.eventType);
        
        GetCalibration(deviceType).then(data => {
            // Ensure we have default values if data is empty
            const processedData = {
                deviceId: deviceType,
                selectedCircleType: data.selectedCircleType || detectedCircleType,
                targetRadius: data.targetRadius || UKA_DEFAULTS[detectedCircleType],
                isCentreSet: data.isCentreSet || false,
                stationCoordinates: data.stationCoordinates || { x: 0, y: 0 },
                edgeVerificationResult: data.edgeVerificationResult || null,
                timestamp: data.timestamp || null,
                ...data // Spread any additional properties
            };
            
            setCalData(processedData);
            setStatus(`Calibration data loaded. Auto-detected: ${detectedCircleType}`);
            console.log('Loaded calibration data with auto-detection:', processedData);
        }).catch(err => {
            console.error('Error loading calibration:', err);
            setStatus(`Error loading calibration: ${err}`);
            // Set default data if loading fails
            setCalData({
                deviceId: deviceType,
                selectedCircleType: detectedCircleType,
                targetRadius: UKA_DEFAULTS[detectedCircleType],
                isCentreSet: false,
                stationCoordinates: { x: 0, y: 0 },
                edgeVerificationResult: null,
                timestamp: null
            });
        }).finally(() => setIsLoading(false));
    };

    useEffect(() => {
        fetchCal();
    }, [deviceType]);

    const handleCircleTypeChange = async (e) => {
        const type = e.target.value;
        const radius = UKA_DEFAULTS[type] || 0;
        
        const newCalData = { 
            ...calData, 
            selectedCircleType: type, 
            targetRadius: radius, 
            isCentreSet: false, 
            edgeVerificationResult: null,
            timestamp: null
        };
        
        setCalData(newCalData);
        setStatus(`Circle type set to ${type} (radius: ${radius.toFixed(4)}m). Ready to set centre.`);
        
        try {
            await SaveCalibration(deviceType, newCalData);
            console.log('Saved calibration after circle type change:', newCalData);
        } catch (error) {
            console.error('Error saving calibration:', error);
            setStatus(`Error saving calibration: ${error}`);
        }
    };

    const handleSetCentre = async () => {
        if (!calData.targetRadius) {
            setStatus("Please select a circle type first.");
            return;
        }
    
        setIsLoading(true);
        setStatus("Setting centre... Aim at circle centre and wait.");
        
        try {
            let updatedCal;
            if (appState.demoMode) {
                updatedCal = await simulateEDMReading('setCentre', true);
            } else {
                updatedCal = await SetCircleCentre(deviceType);
            }
            console.log('Set centre result:', updatedCal);
            
            // Merge the updated calibration with existing data
            const mergedCalData = {
                ...calData,
                ...updatedCal,
                isCentreSet: true,
                timestamp: updatedCal.timestamp || new Date().toISOString()
            };
            
            setCalData(mergedCalData);
            setStatus("Circle centre has been set successfully. Ready to verify edge.");
            console.log('Updated calibration data after centre set:', mergedCalData);
            
        } catch (error) {
            console.error('Error setting centre:', error);
            setStatus(`Error setting centre: ${error}`);
        }
        setIsLoading(false);
    };

    const handleVerifyEdge = async () => {
        if (!calData.isCentreSet) {
            setStatus("Please set the circle centre first.");
            return;
        }
    
        setIsLoading(true);
        setStatus("Verifying edge... Aim at circle edge and wait.");
        
        try {
            let updatedCal;
            if (appState.demoMode) {
                // Pass the current target radius to the simulation
                const targetRadius = calData.targetRadius;
                updatedCal = await simulateEDMReading('verifyEdge', true);
                // Override the target radius in the simulation to match current settings
                updatedCal.edgeVerificationResult.expectedDistanceM = targetRadius;
                const actualDistance = targetRadius + (Math.random() - 0.5) * 0.01; // ±5mm variation
                updatedCal.edgeVerificationResult.actualDistanceM = actualDistance;
                updatedCal.edgeVerificationResult.differenceMm = (actualDistance - targetRadius) * 1000;
                updatedCal.edgeVerificationResult.isInTolerance = Math.abs(updatedCal.edgeVerificationResult.differenceMm) <= 5.0;
            } else {
                updatedCal = await VerifyCircleEdge(deviceType);
            }
            console.log('Verify edge result:', updatedCal);
            
            // Update the calibration data with edge verification results
            const mergedCalData = {
                ...calData,
                ...updatedCal
            };
            
            setCalData(mergedCalData);
            
            if (updatedCal.edgeVerificationResult?.isInTolerance) {
                setStatus("Edge verification passed! Calibration complete.");
            } else {
                setStatus("Edge verification failed tolerance check. Please remeasure or re-center.");
            }
            
            console.log('Updated calibration data after edge verify:', mergedCalData);
            
        } catch (error) {
            console.error('Error verifying edge:', error);
            setStatus(`Error verifying edge: ${error}`);
        }
        setIsLoading(false);
    };

    const handleReset = async () => {
        setIsLoading(true);
        setStatus("Resetting calibration...");
        
        try {
            await ResetCalibration(deviceType);
            console.log('Calibration reset');
            // Reload calibration data after reset
            fetchCal();
            setStatus("Calibration has been reset.");
        } catch (error) {
            console.error('Error resetting calibration:', error);
            setStatus(`Error resetting: ${error}`);
        }
        setIsLoading(false);
    };

    const formatTimestamp = (isoString) => {
        if (!isoString) return "";
        try {
            const date = new Date(isoString);
            return date.toLocaleString('en-GB', { 
                hour: '2-digit', 
                minute: '2-digit', 
                day: '2-digit', 
                month: '2-digit', 
                year: '2-digit' 
            });
        } catch (error) {
            console.error('Error formatting timestamp:', error);
            return "";
        }
    };
    
    // Show loading state
    if (!calData) {
        return (
            <div className="p-4 text-center">
                {isLoading ? "Loading calibration data..." : status}
            </div>
        );
    }

    // Determine calibration state
    const isCircleTypeSelected = calData.selectedCircleType && calData.targetRadius > 0;
    const isCentreSet = calData.isCentreSet === true;
    const isEdgeVerified = calData.edgeVerificationResult?.isInTolerance === true;
    const isCalibrated = isCentreSet && isEdgeVerified;
    
    // Determine next screen
    const nextScreen = appState.operatingMode === 'standalone' ? 'STAND_ALONE_MODE' : 'ATHLETE_LIST';

    console.log('Calibration state:', {
        isCircleTypeSelected,
        isCentreSet,
        isEdgeVerified,
        isCalibrated,
        calData
    });

    return (
        <div className="p-4 md:p-6 max-w-full mx-auto" style={{ paddingBottom: '80px', maxHeight: 'calc(100vh - 60px)', overflowY: 'auto' }}>
            <h1 className="text-2xl font-bold text-center mb-4 text-gray-800">EDM Calibration</h1>
            
            <div className="space-y-4">
                {/* Step 1: Select Circle Type */}
                <div className="p-4 bg-white border rounded-lg shadow-sm">
                    <h3 className="font-semibold text-lg mb-2 flex items-center">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold mr-2 ${isCircleTypeSelected ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'}`}>1</span>
                        Step 1: Select Circle Type
                    </h3>
                    <Select 
                        value={calData.selectedCircleType || ''} 
                        onChange={handleCircleTypeChange} 
                        options={Object.keys(UKA_DEFAULTS).map(k => ({ value: k, label: k }))}
                        disabled={isLoading}
                    />
                    <p className="text-sm text-gray-600 mt-1">
                        Target Radius: {calData.targetRadius ? calData.targetRadius.toFixed(4) : '0.0000'}m
                    </p>
                </div>

                {/* Step 2: Set Circle Centre */}
                <div className={`p-4 bg-white border rounded-lg shadow-sm ${!isCircleTypeSelected ? 'opacity-50' : ''}`}>
                    <h3 className="font-semibold text-lg mb-2 flex items-center">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold mr-2 ${isCentreSet ? 'bg-green-500 text-white' : isCircleTypeSelected ? 'bg-blue-500 text-white' : 'bg-gray-300 text-gray-600'}`}>2</span>
                        Step 2: Set Circle Centre
                    </h3>
                    <p className="text-sm text-gray-600 mb-2">
                        Aim EDM at the exact centre of the circle and press the button.
                    </p>
                    <Button 
                        onClick={handleSetCentre} 
                        icon={Compass} 
                        className={`w-full ${isCentreSet ? 'border-4 border-green-500 bg-green-50' : ''}`} 
                        disabled={!isCircleTypeSelected || isLoading}
                        variant={isCentreSet ? 'success' : 'primary'}
                    >
                        {isCentreSet ? `Centre Set - ${formatTimestamp(calData.timestamp)}` : 'Set Centre'}
                    </Button>
                </div>

                {/* Step 3: Verify Circle Edge */}
                <div className={`p-4 bg-white border rounded-lg shadow-sm ${!isCentreSet ? 'opacity-50' : ''}`}>
                    <h3 className="font-semibold text-lg mb-2 flex items-center">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold mr-2 ${isEdgeVerified ? 'bg-green-500 text-white' : isCentreSet ? 'bg-blue-500 text-white' : 'bg-gray-300 text-gray-600'}`}>3</span>
                        Step 3: Verify Circle Edge
                    </h3>
                    <p className="text-sm text-gray-600 mb-2">
                        Aim EDM at any point on the circle's edge and press the button.
                    </p>
                    <Button 
                        onClick={handleVerifyEdge} 
                        icon={Ruler} 
                        className={`w-full ${calData.edgeVerificationResult ? (calData.edgeVerificationResult.isInTolerance ? 'border-4 border-green-500 bg-green-50' : 'border-4 border-red-500 bg-red-50') : ''}`} 
                        disabled={!isCentreSet || isLoading}
                        variant={isEdgeVerified ? 'success' : calData.edgeVerificationResult && !calData.edgeVerificationResult.isInTolerance ? 'danger' : 'primary'}
                    >
                        <span>Verify Edge</span>
                        {calData.edgeVerificationResult && (
                            <span className="flex items-center ml-2">
                                {calData.edgeVerificationResult.isInTolerance ? 
                                    <CheckCircle size={16} className="text-green-600" /> : 
                                    <XCircle size={16} className="text-red-600" />
                                }
                                <span className="ml-1">
                                    {calData.edgeVerificationResult.differenceMm.toFixed(1)}mm 
                                    (Tol: ±{calData.edgeVerificationResult.toleranceAppliedMm.toFixed(1)}mm)
                                </span>
                            </span>
                        )}
                    </Button>
                </div>
            </div>

            {/* Status Display */}
            <div className="mt-4 p-2 bg-gray-200 rounded-md text-center text-gray-700 text-sm">
                Status: {status}
            </div>

            {/* Navigation */}
            <BottomNavBar>
                <Button 
                    onClick={() => onNavigate('SELECT_DEVICES')} 
                    variant="secondary" 
                    icon={ChevronLeft} 
                    size="lg"
                >
                    Back
                </Button>
                <div className="flex-grow flex justify-center">
                    {isCentreSet && (
                        <Button 
                            onClick={handleReset} 
                            icon={RotateCcw} 
                            size="lg" 
                            variant="danger"
                            disabled={isLoading}
                        >
                            Reset
                        </Button>
                    )}
                </div>
                {isCalibrated ? (
                    <Button 
                        onClick={() => onNavigate(nextScreen)} 
                        icon={ChevronRight} 
                        size="lg"
                    >
                        Next
                    </Button>
                ) : (
                    <div style={{width: '112px'}}></div> // Placeholder to balance the layout
                )}
            </BottomNavBar>
        </div>
    );
};

const StandAloneModeScreen_Standalone = ({ onNavigate, appState }) => {
    const [measurement, setMeasurement] = useState('');
    const [status, setStatus] = useState('Ready');
    const [isMeasuring, setIsMeasuring] = useState(false);
    const [countdown, setCountdown] = useState(0);

    const isThrows = appState.eventType === 'Throws';

    const handleMeasure = async () => {
        setIsMeasuring(true);
        setStatus('Requesting measurement...');
        try {
            const result = isThrows ? await handleThrowMeasure() : await handleWindMeasure();
            setMeasurement(result);
            setStatus(`Measurement received: ${result}`);
        } catch (error) {
            const errorMsg = `Error: ${error}`;
            setStatus(errorMsg);
            setMeasurement('');
        }
        setIsMeasuring(false);
    };
    
    const handleThrowMeasure = async () => {
        if (appState.demoMode) {
            return await simulateEDMReading('measure', true);
        } else {
            return await MeasureThrow("edm");
        }
    };
    
    const handleWindMeasure = () => {
        return new Promise((resolve, reject) => {
            if (appState.demoMode) {
                // For demo mode, simulate the 5-second countdown then return simulated wind
                setCountdown(5);
                const timer = setInterval(() => {
                    setCountdown(prev => {
                        if (prev <= 1) {
                            clearInterval(timer);
                            simulateWindReading(true).then(resolve).catch(reject);
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
            } else {
                // Real wind measurement
                setCountdown(5);
                const timer = setInterval(() => {
                    setCountdown(prev => {
                        if (prev <= 1) {
                            clearInterval(timer);
                            MeasureWind("wind").then(resolve).catch(reject);
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
            }
        });
    };

    return (
        <div className="p-4 md:p-6 max-w-full mx-auto flex flex-col h-full">
            <h1 className="text-2xl font-bold text-center mb-2 text-gray-800">MEASUREMENT MODE</h1>
            <p className="text-center text-lg text-gray-600 mb-4">Event Type: <span className="font-semibold">{appState.eventType}</span> {appState.demoMode && <span className="text-yellow-600 font-bold">(DEMO)</span>}</p>
            <div className="flex-grow grid grid-cols-1 gap-6 content-start">
                <div className="bg-white p-4 rounded-lg shadow-md border">
                    <h2 className="text-xl font-semibold text-blue-700 mb-4">Measure</h2>
                    <Button onClick={handleMeasure} disabled={isMeasuring} size="lg" className="w-full">
                        {isMeasuring ? (countdown > 0 ? `Measuring in ${countdown}...` : 'Measuring...') : `Measure ${isThrows ? 'Distance' : 'Wind'}`}
                    </Button>
                    <div className="mt-4 p-4 bg-gray-100 rounded-lg text-center">
                        <p className="text-lg font-medium text-gray-600">{isThrows ? 'Mark:' : 'Wind:'}</p>
                        <p className="text-7xl font-bold text-gray-800 h-24 flex items-center justify-center">{measurement}</p>
                    </div>
                </div>
            </div>
            <div className="mt-6 p-2 bg-gray-200 rounded-md text-center text-gray-700 text-sm truncate">Status: {status}</div>
            <BottomNavBar>
                <Button onClick={() => onNavigate(appState.eventType === 'Throws' ? 'CALIBRATE_EDM' : 'SELECT_DEVICES')} variant="secondary" icon={ChevronLeft} size="lg">Back</Button>
            </BottomNavBar>
        </div>
    );
};

// --- Main App Component ---
export default function App() {
    const [currentScreen, setCurrentScreen] = useState('MODE_SELECTION');
    const [appState, setAppState] = useState({
        operatingMode: 'standalone',
        serverAddress: '',
        eventType: null,
        eventData: null,
        athletePerformances: {},
        athleteCheckIns: {},
        selectedAthleteBib: null,
        demoMode: false,
        devices: { edm: {}, wind: {}, scoreboard: {} }
    });

    useEffect(() => { SetDemoMode(appState.demoMode); }, [appState.demoMode]);

    const renderScreen = () => {
        if (appState.operatingMode === 'event') {
            switch (currentScreen) {
                case 'MODE_SELECTION': return <ModeSelectionScreen onNavigate={setCurrentScreen} setAppState={setAppState} />;
                case 'EVENT_SETTINGS': return <EventSettingsScreen onNavigate={setCurrentScreen} appState={appState} setAppState={setAppState} />;
                case 'SELECT_DEVICES': return <SelectDevicesScreen_Shared onNavigate={setCurrentScreen} appState={appState} setAppState={setAppState} />;
                case 'CALIBRATE_EDM': return <CalibrateEDMScreen_Standalone onNavigate={setCurrentScreen} appState={appState} setAppState={setAppState} />;
                case 'ATHLETE_LIST': return <AthleteListScreen onNavigate={setCurrentScreen} appState={appState} setAppState={setAppState} />;
                case 'EVENT_MEASUREMENT': return <EventMeasurementScreen onNavigate={setCurrentScreen} appState={appState} setAppState={setAppState} />;
                case 'CUT_RESULTS': return <CutResultsScreen onNavigate={setCurrentScreen} appState={appState} setAppState={setAppState} />;
                default: return <ModeSelectionScreen onNavigate={setCurrentScreen} setAppState={setAppState} />;
            }
        } else { // Standalone Mode
            switch (currentScreen) {
                case 'MODE_SELECTION': return <ModeSelectionScreen onNavigate={setCurrentScreen} setAppState={setAppState} />;
                case 'SELECT_EVENT_TYPE': return <SelectEventTypeScreen_Standalone onNavigate={setCurrentScreen} setAppState={setAppState} />;
                case 'SELECT_DEVICES': return <SelectDevicesScreen_Shared onNavigate={setCurrentScreen} appState={appState} setAppState={setAppState} />;
                case 'CALIBRATE_EDM': return <CalibrateEDMScreen_Standalone onNavigate={setCurrentScreen} appState={appState} setAppState={setAppState} />;
                case 'STAND_ALONE_MODE': return <StandAloneModeScreen_Standalone onNavigate={setCurrentScreen} appState={appState} />;
                default: return <ModeSelectionScreen onNavigate={setCurrentScreen} setAppState={setAppState} />;
            }
        }
    };

    return (
        <div className="h-screen flex flex-col bg-gray-100">
            <header className="bg-blue-700 text-white p-2.5 shadow-md sticky top-0 z-40">
                <h1 className="text-lg font-bold text-center">PolyField by KACPH</h1>
            </header>
            <main className="flex-grow overflow-hidden p-1.5 sm:p-2 w-full max-w-full">
                <div className="bg-white shadow-lg rounded-lg h-full overflow-hidden">
                    {renderScreen()}
                </div>
            </main>
        </div>
    );
}
# PolyField by KACPH

PolyField is a modern, standalone desktop application designed for accurate and efficient measurement of athletic field events, specifically throws (Shot Put, Discus, Hammer, and Javelin). Developed for Kingston & Polytechnic Harriers (KACPH), it replaces manual measurement methods with direct hardware integration, streamlining the officiating process.

Built with Wails v2, PolyField combines a powerful Go backend with a responsive React frontend, offering a robust cross-platform solution for Windows, macOS, and Linux.

## Key Features

-   Standalone Operation: Runs as a single, self-contained desktop application with no need for external servers or internet connectivity.
    
-   Direct Hardware Integration: Communicates directly with Electronic Distance Measurement (EDM) devices via:
    

-   Serial/COM Port: Including USB-to-RS232 adapters.
    
-   Network (TCP/IP): By specifying an IP address and port.
    

-   Guided Calibration Workflow: An intuitive, step-by-step process ensures accurate setup:
    

1.  Select Circle Type: Choose from Shot, Discus, Hammer, or Javelin, which automatically sets the official UKA standard radius.
    
2.  Set Circle Centre: A simple measurement of the circle's centre establishes the EDM's position relative to the field.
    
3.  Verify Circle Edge: A confirmation measurement of the circle's edge provides immediate visual feedback on the calibration's accuracy against UKA tolerances.
    

-   Accurate Measurement: Calculates the official throw distance (from the inside edge of the circle to the landing mark) using trigonometric principles.
    
-   Demo Mode: A built-in mode for training, demonstration, and development without requiring physical hardware. Demo values are generated within realistic ranges for each event type.
    

## Technology Stack

-   Backend: Go
    
-   Frontend: React (with Vite) & Tailwind CSS
    
-   Framework: Wails v2
    
-   Serial Communication: go.bug.st/serial
    

## Core Workflow

The application is designed for a simple, linear workflow:

1.  Select Event Type: Choose 'Throws'.
    
2.  Connect Device: On the Device Setup screen, select either a Serial or Network connection and connect to the EDM.
    
3.  Calibrate:
    

-   Navigate to the Calibration screen.
    
-   Select the appropriate circle type for the event.
    
-   Aim the EDM at the circle's centre and press "Set Centre".
    
-   Aim the EDM at the circle's edge and press "Verify Edge" to confirm accuracy.
    

4.  Measure:
    

-   Once calibration is complete and verified, proceed to the Measurement screen.
    
-   Each press of the "Measure Distance" button will trigger the EDM and display the calculated, official throw distance.
    

## Hardware Communication

### Supported Connections

-   Serial: 9600 baud, 8 data bits, No parity, 1 stop bit (9600-8-N-1).
    
-   Network: TCP/IP connection to a specified IP address and port.
    

### EDM Protocol

The application is configured to work with EDMs that follow this specific command/response protocol:

-   Command Sent: A 3-byte sequence 0x11 0x0D 0x0A (DC1, CR, LF).
    
-   Expected Response: A space-separated ASCII string, terminated by CR+LF.
    

-   Format: [Slope Distance] [Vertical Angle] [Horizontal Angle] [Status Code]
    
-   Example: 0004297 0922606 2101101 85
    

-   0004297: Slope Distance in millimeters (4.297m).
    
-   0922606: Vertical Angle from Zenith in DDDMMSS format (92° 26' 06").
    
-   2101101: Horizontal Angle in DDDMMSS format (210° 11' 01").
    

## Building and Running

### Prerequisites

-   Go 1.18 or later
    
-   Node.js 16 or later
    
-   The Wails v2 CLI
    

### Development Mode

To run the application in live development mode with hot-reloading:

wails dev  
  

### Production Build

To build a standalone, distributable executable for your platform:

wails build  
  

The compiled application will be located in the build/bin directory.

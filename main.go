package main

import (
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func main() {
	// Create an instance of the App structure from app.go
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "PolyField",
		Width:  1280, // Initial width before maximizing
		Height: 800,  // Initial height before maximizing
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// This option tells Wails to start the window maximized.
		WindowStartState: options.Maximised,
		BackgroundColour: &options.RGBA{R: 243, G: 244, B: 246, A: 1},
		OnStartup:        app.wailsStartup,
		OnShutdown:       app.wailsShutdown,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
		},
	})

	if err != nil {
		log.Fatalf("Error running Wails app: %v", err)
	}
}

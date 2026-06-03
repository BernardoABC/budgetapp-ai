package config

import "os"

type Config struct {
	DatabaseURL  string
	Port         string
	CORSOrigin   string
	BCCRAPIToken string
}

func Load() Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	cors := os.Getenv("CORS_ORIGIN")
	if cors == "" {
		cors = "*"
	}
	return Config{
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		Port:         port,
		CORSOrigin:   cors,
		BCCRAPIToken: os.Getenv("BCCR_API_TOKEN"),
	}
}

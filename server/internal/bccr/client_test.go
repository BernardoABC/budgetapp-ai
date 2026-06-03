package bccr

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchRates_extractsSellRate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Error("missing Authorization header")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(bccrResponse{
			Estado: true,
			Datos: []bccrData{{
				Indicadores: []bccrIndicador{
					{
						CodigoIndicador: "317",
						Series:          []bccrSerie{{Fecha: "2026-05-28", ValorDatoPorPeriodo: 449.56}},
					},
					{
						CodigoIndicador: "318",
						Series: []bccrSerie{
							{Fecha: "2026-05-28", ValorDatoPorPeriodo: 455.52},
							{Fecha: "2026-05-29", ValorDatoPorPeriodo: 456.16},
						},
					},
				},
			}},
		})
	}))
	defer srv.Close()

	c := &Client{token: "test", baseURL: srv.URL, httpClient: srv.Client()}
	rates, err := c.FetchRates(context.Background(), "2026-05-28", "2026-05-29")
	if err != nil {
		t.Fatal(err)
	}
	if rates["2026-05-28"] != 455.52 {
		t.Errorf("want 455.52 got %f", rates["2026-05-28"])
	}
	if rates["2026-05-29"] != 456.16 {
		t.Errorf("want 456.16 got %f", rates["2026-05-29"])
	}
}

func TestFetchRates_nonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := &Client{token: "bad", baseURL: srv.URL, httpClient: srv.Client()}
	_, err := c.FetchRates(context.Background(), "2026-05-28", "2026-05-28")
	if err == nil {
		t.Error("expected error for 401")
	}
}

func TestFetchRates_dateFormatConversion(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(bccrResponse{
			Estado: true,
			Datos: []bccrData{{
				Indicadores: []bccrIndicador{
					{CodigoIndicador: "318", Series: []bccrSerie{{Fecha: "2026-05-28", ValorDatoPorPeriodo: 455.52}}},
				},
			}},
		})
	}))
	defer srv.Close()

	c := &Client{token: "t", baseURL: srv.URL, httpClient: srv.Client()}
	c.FetchRates(context.Background(), "2026-05-28", "2026-05-28")
	// BCCR expects slashes in date params (2026/05/28), not dashes
	// Accept either URL-encoded (%2F) or raw slash form
	hasSlashes := gotQuery == "fechaInicio=2026/05/28&fechaFin=2026/05/28&idioma=ES" ||
		gotQuery == "fechaInicio=2026%2F05%2F28&fechaFin=2026%2F05%2F28&idioma=ES"
	if !hasSlashes {
		t.Errorf("expected slashes in date params, got: %s", gotQuery)
	}
}

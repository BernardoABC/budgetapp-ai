package bccr

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const defaultBaseURL = "https://apim.bccr.fi.cr/SDDE/api/Bccr.Ge.SDDE.Publico.Indicadores.API"

type Client struct {
	token      string
	baseURL    string
	httpClient *http.Client
}

func NewClient(token string) *Client {
	return &Client{
		token:      token,
		baseURL:    defaultBaseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

type bccrResponse struct {
	Estado bool       `json:"estado"`
	Datos  []bccrData `json:"datos"`
}
type bccrData struct {
	Indicadores []bccrIndicador `json:"indicadores"`
}
type bccrIndicador struct {
	CodigoIndicador string      `json:"codigoIndicador"`
	Series          []bccrSerie `json:"series"`
}
type bccrSerie struct {
	Fecha               string  `json:"fecha"`
	ValorDatoPorPeriodo float64 `json:"valorDatoPorPeriodo"`
}

// FetchRates fetches the USD→CRC sell rate (indicator 318) for [from, to].
// from and to are YYYY-MM-DD. Returns map keyed by YYYY-MM-DD.
func (c *Client) FetchRates(ctx context.Context, from, to string) (map[string]float64, error) {
	fromFmt := strings.ReplaceAll(from, "-", "/")
	toFmt := strings.ReplaceAll(to, "-", "/")

	url := fmt.Sprintf(
		"%s/cuadro/1/series?fechaInicio=%s&fechaFin=%s&idioma=ES",
		c.baseURL, fromFmt, toFmt,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("bccr new request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bccr request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bccr status %d", resp.StatusCode)
	}

	var body bccrResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("bccr decode: %w", err)
	}
	if !body.Estado || len(body.Datos) == 0 {
		return nil, fmt.Errorf("bccr: empty or failed response")
	}

	rates := make(map[string]float64)
	for _, ind := range body.Datos[0].Indicadores {
		if ind.CodigoIndicador != "318" {
			continue
		}
		for _, s := range ind.Series {
			rates[s.Fecha] = s.ValorDatoPorPeriodo
		}
	}
	if len(rates) == 0 {
		return nil, fmt.Errorf("bccr: indicator 318 not found in response")
	}
	return rates, nil
}

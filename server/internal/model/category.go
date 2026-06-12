package model

type Category struct {
	ID          string `json:"id"`
	GroupID     string `json:"group_id"`
	Name        string `json:"name"`
	Currency    string `json:"currency"`
	Hidden      bool   `json:"hidden"`
	SortOrder   int    `json:"sort_order"`
	IsSystem    bool   `json:"is_system"`
	Rollover    bool   `json:"rollover"`
	Flexibility string `json:"flexibility"`
}

type CategoryGroup struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	SortOrder  int        `json:"sort_order"`
	Hidden     bool       `json:"hidden"`
	IsSystem   bool       `json:"is_system"`
	Categories []Category `json:"categories"`
}

type CreateCategoryReq struct {
	GroupID     string `json:"group_id"`
	Name        string `json:"name"`
	Currency    string `json:"currency"`
	SortOrder   int    `json:"sort_order"`
	Rollover    bool   `json:"rollover"`
	Flexibility string `json:"flexibility"`
}

type UpdateCategoryReq struct {
	Name        string `json:"name"`
	Currency    string `json:"currency"`
	Hidden      bool   `json:"hidden"`
	SortOrder   int    `json:"sort_order"`
	Rollover    bool   `json:"rollover"`
	Flexibility string `json:"flexibility"`
}

type CreateGroupReq struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type UpdateGroupReq struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
	Hidden    bool   `json:"hidden"`
}

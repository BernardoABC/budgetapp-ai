package model

type Category struct {
	ID        string     `json:"id"`
	GroupID   string     `json:"group_id"`
	Name      string     `json:"name"`
	Hidden    bool       `json:"hidden"`
	SortOrder int        `json:"sort_order"`
}

type CategoryGroup struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	SortOrder  int        `json:"sort_order"`
	Hidden     bool       `json:"hidden"`
	Categories []Category `json:"categories"`
}

type CreateCategoryReq struct {
	GroupID   string `json:"group_id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type UpdateCategoryReq struct {
	Name      string `json:"name"`
	Hidden    bool   `json:"hidden"`
	SortOrder int    `json:"sort_order"`
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

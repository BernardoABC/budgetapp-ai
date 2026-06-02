package model

type Category struct {
	ID        string
	GroupID   string
	Name      string
	Hidden    bool
	SortOrder int
}

type CategoryGroup struct {
	ID         string
	Name       string
	SortOrder  int
	Hidden     bool
	Categories []Category
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

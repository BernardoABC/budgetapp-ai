package repository

import "errors"

// ErrNotFound is returned by repositories when a requested row does not exist.
// Handlers branch on it with errors.Is to return a 404.
var ErrNotFound = errors.New("not found")

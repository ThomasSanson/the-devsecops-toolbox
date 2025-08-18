package config

import (
	"errors"
	"io/fs"
	"os"

	"gopkg.in/yaml.v3"
)

const DefaultFile = ".devops.yaml"

// Config represents the DevOps project configuration.
type Config struct {
	ProjectName       string   `yaml:"project_name"`
	Technologies      []string `yaml:"technologies"`
	KubernetesEnabled bool     `yaml:"kubernetes_enabled"`
	ContainerRuntime  string   `yaml:"container_runtime"` // docker|podman
	Version           int      `yaml:"version"`
}

func Default() Config {
	return Config{
		ProjectName:       "",
		Technologies:      []string{},
		KubernetesEnabled: false,
		ContainerRuntime:  "docker",
		Version:           1,
	}
}

func (c *Config) Validate() error {
	switch c.ContainerRuntime {
	case "docker", "podman":
	default:
		return errors.New("container_runtime must be 'docker' or 'podman'")
	}
	return nil
}

func Load(path string) (Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func Save(path string, cfg Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	b, err := yaml.Marshal(&cfg)
	if err != nil {
		return err
	}
	// Ensure dir exists
	if err := os.MkdirAll(dirOf(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, b, fs.FileMode(0o644))
}

func Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			if i == 0 {
				return "/"
			}
			return path[:i]
		}
	}
	return "."
}

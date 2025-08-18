package cmd_test

import (
	"os"
	"path/filepath"
	"testing"

	"devops/cmd"
	"devops/internal/config"
)

func TestInitNonInteractiveCreatesConfig(t *testing.T) {
	tmp := t.TempDir()
	cfg := filepath.Join(tmp, ".devops.yaml")

	root := cmd.NewRootCmd()
	root.SetArgs([]string{
		"--config", cfg,
		"init",
		"--non-interactive",
		"-n", "demo",
		"-t", "go",
		"-t", "kubernetes",
		"--kubernetes",
		"--runtime", "podman",
	})
	if err := root.Execute(); err != nil {
		t.Fatalf("init failed: %v", err)
	}
	if _, err := os.Stat(cfg); err != nil {
		t.Fatalf("config file not created: %v", err)
	}
	c, err := config.Load(cfg)
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}
	if c.ProjectName != "demo" {
		t.Errorf("ProjectName = %q, want demo", c.ProjectName)
	}
	if c.ContainerRuntime != "podman" {
		t.Errorf("ContainerRuntime = %q, want podman", c.ContainerRuntime)
	}
	if !c.KubernetesEnabled {
		t.Errorf("KubernetesEnabled = false, want true")
	}
	if c.Version != 1 {
		t.Errorf("Version = %d, want 1", c.Version)
	}
}

func TestUpdateModifiesFields(t *testing.T) {
	tmp := t.TempDir()
	cfg := filepath.Join(tmp, ".devops.yaml")

	// init first
	root := cmd.NewRootCmd()
	root.SetArgs([]string{"--config", cfg, "init", "--non-interactive", "-n", "demo", "-t", "go", "--kubernetes=false", "--runtime", "docker"})
	if err := root.Execute(); err != nil {
		t.Fatalf("init failed: %v", err)
	}

	// update
	root = cmd.NewRootCmd()
	root.SetArgs([]string{
		"--config", cfg,
		"update",
		"-n", "demo2",
		"-t", "go",
		"-t", "terraform",
		"--kubernetes=true",
		"--runtime", "podman",
	})
	if err := root.Execute(); err != nil {
		t.Fatalf("update failed: %v", err)
	}

	c, err := config.Load(cfg)
	if err != nil {
		t.Fatalf("failed to load config: %v", err)
	}
	if c.ProjectName != "demo2" {
		t.Errorf("ProjectName = %q, want demo2", c.ProjectName)
	}
	if c.ContainerRuntime != "podman" {
		t.Errorf("ContainerRuntime = %q, want podman", c.ContainerRuntime)
	}
	if !c.KubernetesEnabled {
		t.Errorf("KubernetesEnabled = false, want true")
	}
	if len(c.Technologies) != 2 {
		t.Errorf("Technologies length = %d, want 2", len(c.Technologies))
	}
}

func TestUpgradeIncrementsVersion(t *testing.T) {
	tmp := t.TempDir()
	cfg := filepath.Join(tmp, ".devops.yaml")

	// init first
	root := cmd.NewRootCmd()
	root.SetArgs([]string{"--config", cfg, "init", "--non-interactive", "-n", "demo"})
	if err := root.Execute(); err != nil {
		t.Fatalf("init failed: %v", err)
	}
	c1, err := config.Load(cfg)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}

	// upgrade
	root = cmd.NewRootCmd()
	root.SetArgs([]string{"--config", cfg, "upgrade"})
	if err := root.Execute(); err != nil {
		t.Fatalf("upgrade failed: %v", err)
	}
	c2, err := config.Load(cfg)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}
	if c2.Version != c1.Version+1 {
		t.Errorf("Version = %d, want %d", c2.Version, c1.Version+1)
	}
}

func TestInitInvalidRuntimeFails(t *testing.T) {
	tmp := t.TempDir()
	cfg := filepath.Join(tmp, ".devops.yaml")

	root := cmd.NewRootCmd()
	root.SetArgs([]string{"--config", cfg, "init", "--non-interactive", "-n", "demo", "--runtime", "invalid"})
	if err := root.Execute(); err == nil {
		t.Fatalf("expected error for invalid runtime, got nil")
	}
}

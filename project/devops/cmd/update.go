package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"devops/internal/config"
)

type updateOptions struct {
	ProjectName       string
	Technologies      []string
	KubernetesEnabled bool
	ContainerRuntime  string
}

func newUpdateCmd() *cobra.Command {
	opts := &updateOptions{}
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update the existing configuration (replace supplied fields)",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfgPath, _ := cmd.InheritedFlags().GetString("config")
			if !config.Exists(cfgPath) {
				return fmt.Errorf("configuration not found: %s", cfgPath)
			}

			c, err := config.Load(cfgPath)
			if err != nil {
				return err
			}

			if cmd.Flags().Changed("project-name") {
				c.ProjectName = opts.ProjectName
			}
			if cmd.Flags().Changed("tech") {
				c.Technologies = dedupStrings(opts.Technologies)
			}
			if cmd.Flags().Changed("kubernetes") {
				c.KubernetesEnabled = opts.KubernetesEnabled
			}
			if cmd.Flags().Changed("runtime") {
				c.ContainerRuntime = opts.ContainerRuntime
			}

			if err := c.Validate(); err != nil {
				return err
			}
			return config.Save(cfgPath, c)
		},
	}

	cmd.Flags().StringVarP(&opts.ProjectName, "project-name", "n", "", "Project name")
	cmd.Flags().StringArrayVarP(&opts.Technologies, "tech", "t", nil, "Technologies (replaces the list)")
	cmd.Flags().BoolVar(&opts.KubernetesEnabled, "kubernetes", false, "Enable Kubernetes")
	cmd.Flags().StringVar(&opts.ContainerRuntime, "runtime", "", "Container runtime (docker|podman)")

	return cmd
}

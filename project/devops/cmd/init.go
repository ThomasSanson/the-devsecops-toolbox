package cmd

import (
	"fmt"

	survey "github.com/AlecAivazis/survey/v2"
	"github.com/spf13/cobra"

	"devops/internal/config"
)

type initOptions struct {
	ProjectName       string
	Technologies      []string
	KubernetesEnabled bool
	ContainerRuntime  string
	NonInteractive    bool
}

func newInitCmd() *cobra.Command {
	opts := &initOptions{}
	cmd := &cobra.Command{
		Use:   "init",
		Short: "Initialise a DevOps project (interactive or via flags)",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfgPath, err := cmd.Flags().GetString("config")
			if err != nil {
				// Inherited from root
				cfgPath, err = cmd.InheritedFlags().GetString("config")
			}
			if err != nil {
				return err
			}

			if !opts.NonInteractive && opts.ProjectName == "" && len(opts.Technologies) == 0 && opts.ContainerRuntime == "" && !cmd.Flags().Changed("kubernetes") {
				// Interactive mode
				c, err := runInitSurvey()
				if err != nil {
					return err
				}
				return config.Save(cfgPath, c)
			}

			// Non-interactive or flags provided
			c := config.Default()
			if opts.ProjectName != "" {
				c.ProjectName = opts.ProjectName
			}
			if len(opts.Technologies) > 0 {
				c.Technologies = dedupStrings(opts.Technologies)
			}
			if cmd.Flags().Changed("kubernetes") {
				c.KubernetesEnabled = opts.KubernetesEnabled
			}
			if opts.ContainerRuntime != "" {
				c.ContainerRuntime = opts.ContainerRuntime
			}
			if err := c.Validate(); err != nil {
				return err
			}
			return config.Save(cfgPath, c)
		},
	}

	cmd.Flags().StringVarP(&opts.ProjectName, "project-name", "n", "", "Project name")
	cmd.Flags().StringArrayVarP(&opts.Technologies, "tech", "t", nil, "Technologies used (repeat the flag)")
	cmd.Flags().BoolVar(&opts.KubernetesEnabled, "kubernetes", false, "Enable Kubernetes")
	cmd.Flags().StringVar(&opts.ContainerRuntime, "runtime", "", "Container runtime (docker|podman)")
	cmd.Flags().BoolVarP(&opts.NonInteractive, "non-interactive", "y", false, "Do not ask questions (use flags only)")

	return cmd
}

func runInitSurvey() (config.Config, error) {
	c := config.Default()

	var qName = &survey.Input{Message: "Project name:"}
	if err := survey.AskOne(qName, &c.ProjectName, survey.WithValidator(survey.Required)); err != nil {
		return c, err
	}

	techOptions := []string{"go", "python", "node", "java", ".net", "kubernetes", "terraform"}
	var techs []string
	if err := survey.AskOne(&survey.MultiSelect{Message: "Technologies:", Options: techOptions}, &techs); err != nil {
		return c, err
	}
	c.Technologies = dedupStrings(techs)

	if err := survey.AskOne(&survey.Confirm{Message: "Enable Kubernetes?", Default: false}, &c.KubernetesEnabled); err != nil {
		return c, err
	}

	runtimeOptions := []string{"docker", "podman"}
	if err := survey.AskOne(&survey.Select{Message: "Container runtime:", Options: runtimeOptions, Default: "docker"}, &c.ContainerRuntime); err != nil {
		return c, err
	}

	if err := c.Validate(); err != nil {
		return c, fmt.Errorf("invalid configuration: %w", err)
	}
	return c, nil
}

func dedupStrings(in []string) []string {
	m := map[string]struct{}{}
	var out []string
	for _, s := range in {
		if s == "" {
			continue
		}
		if _, ok := m[s]; !ok {
			m[s] = struct{}{}
			out = append(out, s)
		}
	}
	return out
}

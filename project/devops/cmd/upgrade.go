package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"devops/internal/config"
)

func newUpgradeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "upgrade",
		Short: "Upgrade the configuration (for example, increment the version)",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfgPath, _ := cmd.InheritedFlags().GetString("config")
			if !config.Exists(cfgPath) {
				return fmt.Errorf("configuration not found: %s", cfgPath)
			}
			c, err := config.Load(cfgPath)
			if err != nil {
				return err
			}
			c.Version++
			return config.Save(cfgPath, c)
		},
	}
	return cmd
}

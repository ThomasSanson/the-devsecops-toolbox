package cmd

import (
	"github.com/spf13/cobra"
)

// NewRootCmd constructs the root command for the devops CLI.
func NewRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "devops",
		Short: "DevOps CLI to initialise and manage a project",
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	// Global persistent flags
	root.PersistentFlags().StringP("config", "c", ".devops.yaml", "Path to the configuration file")

	// Attach subcommands
	root.AddCommand(newInitCmd())
	root.AddCommand(newUpdateCmd())
	root.AddCommand(newUpgradeCmd())

	return root
}

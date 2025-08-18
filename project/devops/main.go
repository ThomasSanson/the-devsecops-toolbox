package main

import (
	"log"

	"devops/cmd"
)

func main() {
	root := cmd.NewRootCmd()
	if err := root.Execute(); err != nil {
		log.Fatal(err)
	}
}

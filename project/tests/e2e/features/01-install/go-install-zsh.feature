@e2e
Feature: The Go installer sets up the developer's own shell
  As a developer whose login shell is zsh, on a machine where I have no sudo
  I want the Go installer to write GOROOT and GOPATH where zsh reads them
  So that Go works in my next terminal, not only in bash

  # ONE scenario on a fresh Ubuntu machine, in a real terminal. Off camera,
  # zsh is installed, it becomes the login shell of the developer's account,
  # and the account loses sudo. Then the developer types the line
  # task dev:setup-environment runs for Go: .config/go/install.sh.
  #
  # ONE sentence = ONE card = ONE pixel baseline, asserted inside the step
  # (tolerance: 0). Each card is twinned with the same fact checked by code on
  # the machine itself: the account, the startup files and a new zsh.
  @go-install-zsh
  Scenario: Without sudo, the Go installer writes GOROOT and GOPATH to the startup file of zsh, once
    # Note: A fresh Ubuntu machine where the developer's login shell is zsh: $SHELL is /bin/zsh. The account has no sudo, so sudo asks for a password, and Go is not installed.
    # Note: ~/.zshrc holds the four lines Ubuntu puts in ~/.profile: ~/.local/bin joins the PATH when that folder exists. It does not exist yet, so this terminal does not have it.
    # Copy: echo "$SHELL"; sudo -n true; type go; cat ~/.zshrc
    Given a developer whose login shell is zsh has no sudo and no Go
    # Note: The developer runs the Go installer, the same line task dev:setup-environment runs. Without sudo it installs Go in the home folder, under ~/.local/go, and exits with code 0.
    # Note: ~/.zshrc now ends with the two lines the installer added: GOROOT, where Go lives, and GOPATH, where go install puts what it builds.
    # Copy: .config/go/install.sh; echo "exit code: $?"; cat ~/.zshrc
    When the Go installer runs without sudo, it adds GOROOT and GOPATH to ~/.zshrc
    # Note: A new zsh reads ~/.zshrc: GOROOT and GOPATH are set, ~/.local/bin is now on the PATH, and go version answers go1.24.2.
    # Copy: zsh -ic 'echo "GOROOT=$GOROOT"; echo "GOPATH=$GOPATH"; go version'
    Then a new zsh has GOROOT and GOPATH set and runs Go
    # Note: Back in the first terminal, Go is still not on the PATH: ~/.local/bin did not exist when it opened. So a second run installs Go again.
    # Note: grep finds GOROOT and GOPATH once each, on lines 6 and 7 of ~/.zshrc: the second run did not add them again.
    # Copy: .config/go/install.sh; echo "exit code: $?"; grep -n GO ~/.zshrc
    And a second run of the installer does not add the lines twice

@e2e
Feature: A team's own task runs Docker Compose through the project Taskfile
  As a team that writes its own tasks in project/Taskfile.yml
  I want the Taskfile the toolbox generates to name the project's Docker
  Compose command once, at its top
  So that every task we add runs Compose on project/docker-compose.yml the
  same way, from the root of the project

  # ONE scenario on a fresh render of the working-branch template, every
  # answer left at its default, in a real terminal: the top of the generated
  # project/Taskfile.yml, the task the team adds, then that task running.
  #
  # ONE sentence = ONE card = ONE pixel baseline, asserted inside the step
  # (tolerance: 0). Each card is twinned with the same fact checked by code:
  # the file on disk, git's list of changed files and the task's exit code.
  @team-compose-task
  Scenario: A task the team adds runs Docker Compose through PROJECT_DOCKER_COMPOSE
    # Note: A new project named acme, generated with every default answer. Its project/Taskfile.yml starts with one variable, before any task: PROJECT_DOCKER_COMPOSE, set to "cd project && docker compose".
    # Note: Tasks run from the root of the project, so the command first moves into the project folder, where project/docker-compose.yml lives.
    # Copy: head -n 5 project/Taskfile.yml
    Given a new project's Taskfile names its Docker Compose command at the top
    # Note: The team adds one task at the end of the same file: project:deploy:compose:config. Its only command is the variable followed by config. git diff shows those lines and nothing else.
    # Copy: git diff
    When the team adds a task of its own that calls PROJECT_DOCKER_COMPOSE
    # Note: task prints the command it built from the variable: cd project && docker compose config. Docker Compose then prints the configuration it read from project/docker-compose.yml, which starts with "name: acme", the name of the project.
    # Note: The exit code is 0.
    # Copy: task project:deploy:compose:config; echo "exit code: $?"
    Then the team's task runs Docker Compose on the project's own compose file

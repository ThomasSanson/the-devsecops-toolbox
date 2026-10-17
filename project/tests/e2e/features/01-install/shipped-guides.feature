@e2e
Feature: A generated project gets the guides that describe it, not the toolbox's map of itself
  As a developer who generates a project from the toolbox
  I want the guides in docs/guidelines to describe my project
  So that neither I nor an AI agent takes the toolbox's own source tree for mine

  # ONE live terminal in this container and ONE fresh render of the
  # working-branch toolbox with every default answer. The same line is typed in
  # the toolbox, then in the generated project, so the reader compares two
  # pictures of the same folder.
  #
  # ONE sentence = ONE card = ONE pixel baseline, asserted inside the step
  # (tolerance: 0). Each card is twinned with the same fact checked on disk.
  @shipped-guides
  Scenario: The toolbox keeps its task map, and a generated project gets every other guide without it
    # Note: The toolbox itself, in /workspace. Its docs/guidelines folder holds three guides: CI runners.md, DevSecOps.md and Task Mapping.md.
    # Note: The first lines of Task Mapping.md say what it describes: "Task Mapping - The DevSecOps Toolbox", of type "Copier Template for DevSecOps pipeline scaffolding". That is the toolbox itself, not a project generated from it.
    # Copy: ls docs/guidelines && head -n 5 "docs/guidelines/Task Mapping.md"
    Given the toolbox's guides folder holds a task map of the toolbox itself
    # Note: Off camera, Copier generates a new project from the toolbox with every default answer, in /tmp/e2e-shipped-guides. The same line is typed there.
    # Note: Its docs/guidelines folder holds CI runners.md and DevSecOps.md. head answers "No such file or directory": the toolbox keeps its task map out of the projects it generates.
    # Copy: uvx --python 3.14 --from copier==9.14.3 copier copy --defaults --skip-tasks /workspace /tmp/e2e-shipped-guides && cd /tmp/e2e-shipped-guides && ls docs/guidelines && head -n 5 "docs/guidelines/Task Mapping.md"
    Then a project generated with every default answer gets the other guides and no task map

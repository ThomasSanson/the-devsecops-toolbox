@e2e
Feature: A storyboard shows every picture as large as it can
  As a reviewer who reads a story from its storyboard alone
  I want a whole GitLab page shown at its real size, and smaller captures side by side
  So that the small text of a page stays readable and the board stays short

  # The storyboard engine lays its cards out in reading order, two per row. A
  # picture that would be shrunk in a half row, such as a GitLab page 1440 px
  # wide, takes a row of its own instead. A picture left alone on its row sits in
  # the middle of it, so the board never looks like a card is missing.
  #
  # The real engine draws a small board from five pictures of the sizes the
  # suite produces. The card is that board as a browser shows it, and its twin
  # reads the size and place of every card from the board's own file.
  @storyboard-wide-card
  Scenario: A whole GitLab page gets a row of its own in a storyboard, at its real size
    # Note: A storyboard drawn by the real engine from five pictures: a short terminal capture, a whole GitLab page 1440 pixels wide, a long output strip 960 pixels wide, a second terminal capture and a page 2000 pixels tall.
    # Note: The 1440 pixel page takes the full width of the board and keeps its real size, so its small text stays readable. Its long note wraps at a comfortable width instead of running across the whole board.
    # Note: The other pictures share rows two by two. The 960 pixel strip is shrunk into its half of the row. The tall page has to be shrunk to fit the height limit anyway, so it keeps a half row. A picture alone on its row sits in the middle of it.
    Then a storyboard gives a whole GitLab page a full row at its real size and keeps shorter captures two per row

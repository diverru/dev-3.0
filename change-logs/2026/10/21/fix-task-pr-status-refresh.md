Short: PR badges stay current

PR badges keep their state and CI current after branch changes and while a task stays open, including narrow layouts. Regular reads use GraphQL with a shared one-minute cache and coalesced requests; boards check every minute in the active project and every five minutes in the background. Manual refresh requests fresh PR data alongside git fetch, while GitHub CLI continues to handle credentials and user commands.

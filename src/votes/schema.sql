CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    duration_hours INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed'))
);

CREATE TABLE IF NOT EXISTS vote_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vote_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    FOREIGN KEY (vote_id) REFERENCES votes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vote_preferences (
    user_id TEXT NOT NULL,
    vote_id INTEGER NOT NULL,
    option_a_id INTEGER NOT NULL,
    option_b_id INTEGER NOT NULL,
    preference INTEGER NOT NULL,
    FOREIGN KEY (vote_id) REFERENCES votes(id) ON DELETE CASCADE,
    FOREIGN KEY (option_a_id) REFERENCES vote_options(id) ON DELETE CASCADE,
    FOREIGN KEY (option_b_id) REFERENCES vote_options(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, vote_id, option_a_id, option_b_id)
);

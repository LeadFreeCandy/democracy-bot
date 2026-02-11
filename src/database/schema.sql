CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL UNIQUE COLLATE NOCASE,
    submitted_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    watched INTEGER DEFAULT 0,
    watched_at INTEGER
);

CREATE TABLE IF NOT EXISTS pairwise_preferences (
    user_id TEXT NOT NULL,
    movie_a_id INTEGER NOT NULL,
    movie_b_id INTEGER NOT NULL,
    preference INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (movie_a_id) REFERENCES movies(id) ON DELETE CASCADE,
    FOREIGN KEY (movie_b_id) REFERENCES movies(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, movie_a_id, movie_b_id)
);

CREATE TABLE IF NOT EXISTS control_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    event_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
    user_id TEXT NOT NULL,
    event_date TEXT NOT NULL,
    attending INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, event_date)
);

CREATE TABLE IF NOT EXISTS reminders_sent (
    event_date TEXT NOT NULL,
    reminder_type TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (event_date, reminder_type)
);

CREATE TABLE IF NOT EXISTS movie_ratings (
    user_id TEXT NOT NULL,
    movie_id INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, movie_id)
);

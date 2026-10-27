"""SQLite storage for ReviewPulse AI.

All SQL uses parameters (?) so user text is never pasted into a query string.
"""

import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone

DATABASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reviewpulse.db")

MAX_HISTORY_LIMIT = 50

SCHEMA = """
CREATE TABLE IF NOT EXISTS analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    summary TEXT NOT NULL,
    review_count INTEGER NOT NULL,
    positive_count INTEGER NOT NULL,
    neutral_count INTEGER NOT NULL,
    negative_count INTEGER NOT NULL,
    themes_json TEXT NOT NULL,
    recommendations_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    review_index INTEGER NOT NULL,
    review_text TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    urgency TEXT NOT NULL,
    themes_json TEXT NOT NULL,
    suggested_response TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES analysis_runs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_review_results_run_id ON review_results (run_id);
"""


def get_connection():
    """Open a connection that returns rows like dictionaries and enforces foreign keys."""
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    """Create the tables if they do not exist yet."""
    with closing(get_connection()) as connection:
        with connection:
            connection.executescript(SCHEMA)


def save_analysis(summary, counts, common_themes, recommendations, review_rows):
    """Save one analysis run and all of its reviews in a single transaction.

    If anything fails, the transaction rolls back and nothing is saved.
    Returns the new run id.
    """
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    with closing(get_connection()) as connection:
        with connection:  # commits on success, rolls back on error
            cursor = connection.execute(
                """
                INSERT INTO analysis_runs (
                    created_at, summary, review_count,
                    positive_count, neutral_count, negative_count,
                    themes_json, recommendations_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    created_at,
                    summary,
                    len(review_rows),
                    counts["positive"],
                    counts["neutral"],
                    counts["negative"],
                    json.dumps(common_themes),
                    json.dumps(recommendations),
                ),
            )
            run_id = cursor.lastrowid

            connection.executemany(
                """
                INSERT INTO review_results (
                    run_id, review_index, review_text, sentiment,
                    urgency, themes_json, suggested_response
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        run_id,
                        row["index"],
                        row["review_text"],
                        row["sentiment"],
                        row["urgency"],
                        json.dumps(row["themes"]),
                        row["suggested_response"],
                    )
                    for row in review_rows
                ],
            )
    return run_id


def list_runs(limit=10):
    """Return the most recent analysis runs, newest first, with an explicit limit."""
    limit = max(1, min(int(limit), MAX_HISTORY_LIMIT))
    with closing(get_connection()) as connection:
        rows = connection.execute(
            """
            SELECT id, created_at, summary, review_count,
                   positive_count, neutral_count, negative_count
            FROM analysis_runs
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_run(run_id):
    """Return one saved analysis with its reviews, or None if it does not exist."""
    with closing(get_connection()) as connection:
        run = connection.execute(
            "SELECT * FROM analysis_runs WHERE id = ?", (run_id,)
        ).fetchone()
        if run is None:
            return None

        review_rows = connection.execute(
            """
            SELECT review_index, review_text, sentiment, urgency,
                   themes_json, suggested_response
            FROM review_results
            WHERE run_id = ?
            ORDER BY review_index
            """,
            (run_id,),
        ).fetchall()

    return {
        "id": run["id"],
        "created_at": run["created_at"],
        "summary": run["summary"],
        "review_count": run["review_count"],
        "counts": {
            "positive": run["positive_count"],
            "neutral": run["neutral_count"],
            "negative": run["negative_count"],
        },
        "common_themes": json.loads(run["themes_json"]),
        "recommendations": json.loads(run["recommendations_json"]),
        "reviews": [
            {
                "index": row["review_index"],
                "review_text": row["review_text"],
                "sentiment": row["sentiment"],
                "urgency": row["urgency"],
                "themes": json.loads(row["themes_json"]),
                "suggested_response": row["suggested_response"],
            }
            for row in review_rows
        ],
    }

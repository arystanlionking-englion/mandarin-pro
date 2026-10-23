-- Mandarin Pro: Журнал учеников + персональные ссылки для родителей
-- Supabase / PostgreSQL schema (optional relational layer)
--
-- Основной JSON-базис уже хранится в app_data.value (JSONB):
--   value.journal.students[].parentToken
--   value.journal.attendance[]  ({ id, studentId, date, status, note, createdAt, updatedAt })
--
-- Этот скрипт создаёт нормализованные таблицы для выборок и внешних интеграций.
-- Применяйте в Supabase SQL Editor при необходимости.

CREATE TABLE IF NOT EXISTS journal_students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_id TEXT,
    user_id TEXT,
    parent_token TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_attendance (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES journal_students(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_id, date)
);

CREATE TABLE IF NOT EXISTS journal_grade_records (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES journal_students(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    subject TEXT NOT NULL DEFAULT 'Китайский язык',
    percent INTEGER NOT NULL CHECK (percent >= 0 AND percent <= 100),
    letter TEXT,
    gpa NUMERIC,
    traditional TEXT,
    color TEXT,
    base_points INTEGER,
    bonus INTEGER DEFAULT 0,
    points INTEGER,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_attendance_student_date
    ON journal_attendance (student_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_journal_attendance_date
    ON journal_attendance (date DESC);

CREATE INDEX IF NOT EXISTS idx_journal_grades_student_date
    ON journal_grade_records (student_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_journal_students_parent_token
    ON journal_students (parent_token);

-- RLS: публичный parent-view читает только через серверный токен (API),
-- прямой доступ к таблицам из браузера не требуется.
ALTER TABLE journal_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_grade_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'journal_students' AND policyname = 'service_role_all_journal_students'
    ) THEN
        CREATE POLICY service_role_all_journal_students ON journal_students
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'journal_attendance' AND policyname = 'service_role_all_journal_attendance'
    ) THEN
        CREATE POLICY service_role_all_journal_attendance ON journal_attendance
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'journal_grade_records' AND policyname = 'service_role_all_journal_grades'
    ) THEN
        CREATE POLICY service_role_all_journal_grades ON journal_grade_records
            FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

INSERT OR IGNORE INTO organizations (id, name, google_domain) VALUES
  ('org-demo', 'Escuela Secundaria Demo', 'escuela.example.edu');

INSERT OR IGNORE INTO users (id, email, email_verified, name, role, google_sub, org_id) VALUES
  ('teacher-demo', 'mariana@escuela.example.edu', 1, 'Mariana Costa', 'teacher', 'google-teacher-demo', 'org-demo'),
  ('student-demo', 'sofia@escuela.example.edu', 1, 'Sofía Álvarez', 'student', 'google-student-demo', 'org-demo'),
  ('student-demo-2', 'tomas@escuela.example.edu', 1, 'Tomás Benítez', 'student', 'google-student-demo-2', 'org-demo');

INSERT OR IGNORE INTO exams (id, org_id, author_id, title, subject, instructions, time_limit_s, status) VALUES
  ('exam-biology-demo', 'org-demo', 'teacher-demo', 'Fotosíntesis y respiración celular', 'Biología', 'Leé cada consigna antes de responder.', 2400, 'ready');

INSERT OR IGNORE INTO questions (id, exam_id, position, type, prompt, points, config) VALUES
  ('demo-q1', 'exam-biology-demo', 0, 'mc', '¿Qué proceso transforma energía lumínica en química?', 2, '{"options":[{"id":"a","text":"Respiración"},{"id":"b","text":"Fotosíntesis"}],"correctOptionId":"b"}'),
  ('demo-q2', 'exam-biology-demo', 1, 'sa', '¿Cuál es el pigmento principal?', 2, '{"accepted":["clorofila"]}'),
  ('demo-q3', 'exam-biology-demo', 2, 'long', 'Explicá su importancia para el ecosistema.', 4, '{}');

INSERT OR IGNORE INTO runs (id, org_id, author_id, exam_id, code, title, questions_snapshot, time_limit_s, status, created_at, started_at, ends_at) VALUES
  ('run-biology-demo', 'org-demo', 'teacher-demo', 'exam-biology-demo', 'K7M4QH', 'Fotosíntesis y respiración celular', '[{"id":"demo-q1","position":0,"type":"mc","prompt":"¿Qué proceso transforma energía lumínica en química?","points":2,"config":{"options":[{"id":"a","text":"Respiración"},{"id":"b","text":"Fotosíntesis"}],"correctOptionId":"b"}},{"id":"demo-q2","position":1,"type":"sa","prompt":"¿Cuál es el pigmento principal?","points":2,"config":{"accepted":["clorofila"]}},{"id":"demo-q3","position":2,"type":"long","prompt":"Explicá su importancia para el ecosistema.","points":4,"config":{}}]', 2400, 'running', (unixepoch() * 1000), (unixepoch() * 1000), ((unixepoch() + 2400) * 1000));

UPDATE runs
SET status = 'running', started_at = (unixepoch() * 1000), ends_at = ((unixepoch() + 2400) * 1000), ended_at = NULL
WHERE id = 'run-biology-demo';

INSERT OR IGNORE INTO runs (id, org_id, author_id, exam_id, code, title, questions_snapshot, time_limit_s, status, created_at, started_at, ends_at, ended_at) VALUES
  ('run-biology-ended', 'org-demo', 'teacher-demo', 'exam-biology-demo', 'P9XR3A', 'Fotosíntesis y respiración celular', '[{"id":"demo-q1","position":0,"type":"mc","prompt":"¿Qué proceso transforma energía lumínica en química?","points":2,"config":{"options":[{"id":"a","text":"Respiración"},{"id":"b","text":"Fotosíntesis"}],"correctOptionId":"b"}},{"id":"demo-q2","position":1,"type":"sa","prompt":"¿Cuál es el pigmento principal?","points":2,"config":{"accepted":["clorofila"]}},{"id":"demo-q3","position":2,"type":"long","prompt":"Explicá su importancia para el ecosistema.","points":4,"config":{}}]', 2400, 'ended', ((unixepoch() - 86400) * 1000), ((unixepoch() - 86400) * 1000), ((unixepoch() - 84000) * 1000), ((unixepoch() - 84000) * 1000));

INSERT OR IGNORE INTO participants (id, run_id, user_id, status, joined_at, submitted_at, submit_reason, last_seen) VALUES
  ('participant-ended-demo', 'run-biology-ended', 'student-demo-2', 'submitted', ((unixepoch() - 86400) * 1000), ((unixepoch() - 84060) * 1000), 'manual', ((unixepoch() - 84060) * 1000));

INSERT OR IGNORE INTO answers (id, participant_id, question_id, value, updated_at) VALUES
  ('answer-ended-1', 'participant-ended-demo', 'demo-q1', '"b"', ((unixepoch() - 84100) * 1000)),
  ('answer-ended-2', 'participant-ended-demo', 'demo-q2', '"clorofila"', ((unixepoch() - 84090) * 1000)),
  ('answer-ended-3', 'participant-ended-demo', 'demo-q3', '"La fotosíntesis sostiene las cadenas alimentarias y libera oxígeno para otros organismos."', ((unixepoch() - 84080) * 1000));

INSERT OR IGNORE INTO grades (id, participant_id, question_id, auto, override, points_awarded) VALUES
  ('grade-ended-1', 'participant-ended-demo', 'demo-q1', 1, NULL, 2),
  ('grade-ended-2', 'participant-ended-demo', 'demo-q2', 1, NULL, 2),
  ('grade-ended-3', 'participant-ended-demo', 'demo-q3', NULL, NULL, NULL);

INSERT OR IGNORE INTO incidents (id, participant_id, at, duration_ms, type, meta, source) VALUES
  ('incident-ended-1', 'participant-ended-demo', ((unixepoch() - 84200) * 1000), 4200, 'cambio-de-pestana', '{}', 'client');

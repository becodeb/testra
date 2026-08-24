INSERT INTO organizations (id, name, google_domain) VALUES
  ('org-demo', 'Escuela Secundaria Demo', 'escuela.example.edu')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, email_verified, name, role, google_sub, org_id) VALUES
  ('teacher-demo', 'mariana@escuela.example.edu', true, 'Mariana Costa', 'teacher', 'google-teacher-demo', 'org-demo'),
  ('student-demo', 'sofia@escuela.example.edu', true, 'Sofía Álvarez', 'student', 'google-student-demo', 'org-demo'),
  ('student-demo-2', 'tomas@escuela.example.edu', true, 'Tomás Benítez', 'student', 'google-student-demo-2', 'org-demo')
ON CONFLICT DO NOTHING;

INSERT INTO exams (id, org_id, author_id, title, subject, instructions, time_limit_s, status) VALUES
  ('exam-biology-demo', 'org-demo', 'teacher-demo', 'Fotosíntesis y respiración celular', 'Biología', 'Leé cada consigna antes de responder.', 2400, 'ready')
ON CONFLICT DO NOTHING;

INSERT INTO questions (id, exam_id, position, type, prompt, points, config) VALUES
  ('demo-q1', 'exam-biology-demo', 0, 'mc', '¿Qué proceso transforma energía lumínica en química?', 2, '{"options":[{"id":"a","text":"Respiración"},{"id":"b","text":"Fotosíntesis"}],"correctOptionId":"b"}'),
  ('demo-q2', 'exam-biology-demo', 1, 'sa', '¿Cuál es el pigmento principal?', 2, '{"accepted":["clorofila"]}'),
  ('demo-q3', 'exam-biology-demo', 2, 'long', 'Explicá su importancia para el ecosistema.', 4, '{}')
ON CONFLICT DO NOTHING;

INSERT INTO runs (id, org_id, author_id, exam_id, code, title, questions_snapshot, time_limit_s, status, created_at, started_at, ends_at) VALUES
  ('run-biology-demo', 'org-demo', 'teacher-demo', 'exam-biology-demo', 'K7M4QH', 'Fotosíntesis y respiración celular', '[{"id":"demo-q1","position":0,"type":"mc","prompt":"¿Qué proceso transforma energía lumínica en química?","points":2,"config":{"options":[{"id":"a","text":"Respiración"},{"id":"b","text":"Fotosíntesis"}],"correctOptionId":"b"}},{"id":"demo-q2","position":1,"type":"sa","prompt":"¿Cuál es el pigmento principal?","points":2,"config":{"accepted":["clorofila"]}},{"id":"demo-q3","position":2,"type":"long","prompt":"Explicá su importancia para el ecosistema.","points":4,"config":{}}]', 2400, 'running', ((extract(epoch from now()) * 1000)::bigint), ((extract(epoch from now()) * 1000)::bigint), (((extract(epoch from now()) + 2400) * 1000)::bigint))
ON CONFLICT DO NOTHING;

UPDATE runs
SET status = 'running', started_at = ((extract(epoch from now()) * 1000)::bigint), ends_at = (((extract(epoch from now()) + 2400) * 1000)::bigint), ended_at = NULL
WHERE id = 'run-biology-demo';

INSERT INTO runs (id, org_id, author_id, exam_id, code, title, questions_snapshot, time_limit_s, status, created_at, started_at, ends_at, ended_at) VALUES
  ('run-biology-ended', 'org-demo', 'teacher-demo', 'exam-biology-demo', 'P9XR3A', 'Fotosíntesis y respiración celular', '[{"id":"demo-q1","position":0,"type":"mc","prompt":"¿Qué proceso transforma energía lumínica en química?","points":2,"config":{"options":[{"id":"a","text":"Respiración"},{"id":"b","text":"Fotosíntesis"}],"correctOptionId":"b"}},{"id":"demo-q2","position":1,"type":"sa","prompt":"¿Cuál es el pigmento principal?","points":2,"config":{"accepted":["clorofila"]}},{"id":"demo-q3","position":2,"type":"long","prompt":"Explicá su importancia para el ecosistema.","points":4,"config":{}}]', 2400, 'ended', (((extract(epoch from now()) - 86400) * 1000)::bigint), (((extract(epoch from now()) - 86400) * 1000)::bigint), (((extract(epoch from now()) - 84000) * 1000)::bigint), (((extract(epoch from now()) - 84000) * 1000)::bigint))
ON CONFLICT DO NOTHING;

INSERT INTO participants (id, run_id, user_id, display_name, status, joined_at, submitted_at, submit_reason, last_seen) VALUES
  ('participant-ended-demo', 'run-biology-ended', 'student-demo-2', 'Tomás Benítez', 'submitted', (((extract(epoch from now()) - 86400) * 1000)::bigint), (((extract(epoch from now()) - 84060) * 1000)::bigint), 'manual', (((extract(epoch from now()) - 84060) * 1000)::bigint))
ON CONFLICT DO NOTHING;

INSERT INTO answers (id, participant_id, question_id, value, updated_at) VALUES
  ('answer-ended-1', 'participant-ended-demo', 'demo-q1', '"b"', (((extract(epoch from now()) - 84100) * 1000)::bigint)),
  ('answer-ended-2', 'participant-ended-demo', 'demo-q2', '"clorofila"', (((extract(epoch from now()) - 84090) * 1000)::bigint)),
  ('answer-ended-3', 'participant-ended-demo', 'demo-q3', '"La fotosíntesis sostiene las cadenas alimentarias y libera oxígeno para otros organismos."', (((extract(epoch from now()) - 84080) * 1000)::bigint))
ON CONFLICT DO NOTHING;

INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded) VALUES
  ('grade-ended-1', 'participant-ended-demo', 'demo-q1', 1, NULL, 2),
  ('grade-ended-2', 'participant-ended-demo', 'demo-q2', 1, NULL, 2),
  ('grade-ended-3', 'participant-ended-demo', 'demo-q3', NULL, NULL, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO incidents (id, participant_id, at, duration_ms, type, meta, source) VALUES
  ('incident-ended-1', 'participant-ended-demo', (((extract(epoch from now()) - 84200) * 1000)::bigint), 4200, 'cambio-de-pestana', '{}', 'client')
ON CONFLICT DO NOTHING;

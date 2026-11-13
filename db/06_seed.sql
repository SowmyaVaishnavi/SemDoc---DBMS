-- =====================================================================
-- 06  SEED DATA  (demo users, documents, versions, tags, access, comments)
--     Demo password for every account: Demo@12345  (bcrypt hashes only)
--     Embeddings and semantic changes are NOT created here: they come
--     from the app's embedding module, or from dev/07_dev_embeddings.sql
--     when you want to try the queries before the app exists.
-- =====================================================================

BEGIN;

-- Users ---------------------------------------------------------------
INSERT INTO users (name, email, password_hash, role) VALUES
 ('Asha Nair',   'asha@example.com',  '$2b$10$6MxwuVL6IufecM0T8zzDmuGyOWSmmvjTZPE/5w651fTVBmM2UC2wm', 'Admin'),
 ('Ravi Kumar',  'ravi@example.com',  '$2b$10$X9CiZGRl5AwTMMVN4frCA.U2.wULwbnG.WFhVVVYy8BPQYHNKJTcy', 'Editor'),
 ('Meera Iyer',  'meera@example.com', '$2b$10$pKEvpX7aESn4mRAXeVMw2ORE34SbXvarDp.KNSVH8.lvMn/x8a6Sy', 'Editor'),
 ('Kiran Shah',  'kiran@example.com', '$2b$10$WsnqnE4o7bH6j6ceBcQ7PeF9CboVtNhDUAHWdTNMO7Pbmy3k3SmFu', 'Viewer');

-- Documents (trigger trg_document_owner_access adds the Owner access rows)
INSERT INTO documents (title, description, owner_id) VALUES
 ('Remote Work Policy',        'Company rules for working from home',
    (SELECT user_id FROM users WHERE email = 'ravi@example.com')),
 ('Product Launch Plan',       'Timeline and tasks for the spring launch',
    (SELECT user_id FROM users WHERE email = 'meera@example.com')),
 ('Data Retention Guidelines', 'How long customer data is kept',
    (SELECT user_id FROM users WHERE email = 'ravi@example.com')),
 ('Onboarding Handbook',      'First-week guide for new hires',
    (SELECT user_id FROM users WHERE email = 'meera@example.com'));

-- Helper used only by this seed script ----------------------------------
CREATE TEMP TABLE seed_versions (
    title text, version_number int, author_email text,
    commit_message text, content text, created_at timestamptz
) ON COMMIT DROP;

INSERT INTO seed_versions VALUES
-- Remote Work Policy: v1 base, v2 small addition, v3 reworded, v4 unrelated rewrite
('Remote Work Policy', 1, 'ravi@example.com', 'Initial policy',
E'Employees may work from home up to three days a week.\nManagers must approve the schedule in advance.\nEmployees must be reachable during core hours.\nCompany equipment must be kept secure at home.',
 now() - interval '60 days'),
('Remote Work Policy', 2, 'meera@example.com', 'Add internet allowance',
E'Employees may work from home up to three days a week.\nManagers must approve the schedule in advance.\nEmployees must be reachable during core hours.\nCompany equipment must be kept secure at home.\nA monthly internet allowance is paid to remote employees.',
 now() - interval '45 days'),
('Remote Work Policy', 3, 'ravi@example.com', 'Reword for clarity',
E'Staff are allowed to do their jobs from home for as many as three days each week.\nA manager has to sign off on the plan beforehand.\nStaff should be contactable during the central working hours.\nLaptops and other company property need safe storage at home.\nA monthly internet allowance is paid to remote employees.',
 now() - interval '20 days'),
('Remote Work Policy', 4, 'meera@example.com', 'Rewrite as office relocation notice',
E'The head office will move to the new Whitefield campus in March.\nParking passes are issued by the facilities team.\nThe cafeteria will offer a new lunch menu every week.\nVisitors must register at the reception desk.',
 now() - interval '5 days'),

-- Product Launch Plan: three versions, additions then a rewrite
('Product Launch Plan', 1, 'meera@example.com', 'Draft launch plan',
E'Launch the mobile app in April.\nMarketing campaign starts two weeks before launch.\nSupport team trains on the new features.',
 now() - interval '30 days'),
('Product Launch Plan', 2, 'meera@example.com', 'Add beta testing',
E'Launch the mobile app in April.\nMarketing campaign starts two weeks before launch.\nSupport team trains on the new features.\nBeta testing with fifty customers runs in March.',
 now() - interval '12 days'),
('Product Launch Plan', 3, 'ravi@example.com', 'Shift to phased rollout',
E'Roll out the mobile app in phases starting in May.\nMarketing campaign begins after the first phase succeeds.\nSupport team trains on the new features.\nBeta testing with fifty customers runs in March.',
 now() - interval '3 days'),

-- Data Retention Guidelines: two versions, left untouched for a long time
('Data Retention Guidelines', 1, 'ravi@example.com', 'Initial guidelines',
E'Customer records are kept for seven years.\nBackups are deleted after ninety days.\nDeletion requests are handled within thirty days.',
 now() - interval '90 days'),
('Data Retention Guidelines', 2, 'ravi@example.com', 'Shorten record retention',
E'Customer records are kept for five years.\nBackups are deleted after ninety days.',
 now() - interval '70 days'),

-- Onboarding Handbook: a single version
('Onboarding Handbook', 1, 'meera@example.com', 'First version',
E'Collect your laptop and badge on day one.\nMeet your buddy and your manager.\nComplete the security training in the first week.',
 now() - interval '15 days');

INSERT INTO document_versions
        (doc_id, version_number, content_text, content_hash, commit_message, created_by, created_at)
SELECT d.doc_id, s.version_number, s.content,
       encode(sha256(convert_to(s.content, 'UTF8')), 'hex'),
       s.commit_message, u.user_id, s.created_at
FROM   seed_versions s
JOIN   documents d ON d.title = s.title
JOIN   users u     ON u.email = s.author_email
ORDER  BY d.doc_id, s.version_number;

-- The trigger stamped updated_at = now(); make it match the demo history
UPDATE documents d
SET    updated_at = (SELECT max(created_at) FROM document_versions v WHERE v.doc_id = d.doc_id);

-- Tags and document_tags -------------------------------------------------
INSERT INTO tags (tag_name) VALUES ('policy'), ('hr'), ('planning'), ('launch'), ('compliance');

INSERT INTO document_tags (doc_id, tag_id)
SELECT d.doc_id, t.tag_id
FROM (VALUES ('Remote Work Policy','policy'),   ('Remote Work Policy','hr'),
             ('Product Launch Plan','planning'), ('Product Launch Plan','launch'),
             ('Data Retention Guidelines','policy'), ('Data Retention Guidelines','compliance'),
             ('Onboarding Handbook','hr')) AS x(title, tag)
JOIN documents d ON d.title = x.title
JOIN tags t      ON t.tag_name = x.tag;

-- Extra access rows (Owner rows already exist) -----------------------------
INSERT INTO document_access (doc_id, user_id, access_role)
SELECT d.doc_id, u.user_id, x.role
FROM (VALUES ('Remote Work Policy','meera@example.com','Editor'),
             ('Remote Work Policy','kiran@example.com','Viewer'),
             ('Product Launch Plan','ravi@example.com','Editor'),
             ('Product Launch Plan','kiran@example.com','Viewer'),
             ('Onboarding Handbook','kiran@example.com','Viewer')) AS x(title, email, role)
JOIN documents d ON d.title = x.title
JOIN users u     ON u.email = x.email;

-- Comments -------------------------------------------------------------------
INSERT INTO comments (version_id, user_id, comment_text)
SELECT v.version_id, u.user_id, x.txt
FROM (VALUES ('Remote Work Policy', 4, 'kiran@example.com', 'This looks like a different document. Was the policy replaced by mistake?'),
             ('Remote Work Policy', 4, 'ravi@example.com',  'Yes, wrong text pasted. I will restore the policy next.'),
             ('Remote Work Policy', 2, 'ravi@example.com',  'Thanks for adding the allowance.'),
             ('Product Launch Plan', 3, 'meera@example.com', 'Phased rollout was agreed in Monday''s meeting.'),
             ('Data Retention Guidelines', 2, 'ravi@example.com', 'Aligned with the new compliance review.')) AS x(title, vno, email, txt)
JOIN documents d          ON d.title = x.title
JOIN document_versions v  ON v.doc_id = d.doc_id AND v.version_number = x.vno
JOIN users u              ON u.email = x.email;

COMMIT;

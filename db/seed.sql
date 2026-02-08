-- Seed data: Zscaler workshop questions
-- Categories
INSERT INTO categories (admin_id, name, sort_order, timer_seconds) VALUES
(1, 'Zero Trust for Users (ZIA/ZPA)', 1, 15),
(1, 'Digital Experience (ZDX)', 2, 15),
(1, 'Branch & IoT/OT', 3, 15),
(1, 'Data Protection (DLP)', 4, 15),
(1, 'Workload Protection', 5, 15);

-- Category 1: Zero Trust for Users (ZIA/ZPA)
INSERT INTO questions (category_id, admin_id, question_text, sort_order) VALUES
(1, 1, 'What does ZPA stand for?', 1),
(1, 1, 'Which protocol does ZIA inspect to protect users from threats?', 2),
(1, 1, 'What is the primary benefit of Zscaler''s Zero Trust Exchange?', 3);

-- Q1 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(1, 'Zscaler Private Access', 1, 1),
(1, 'Zero Protocol Architecture', 0, 2),
(1, 'Zscaler Public Analytics', 0, 3),
(1, 'Zone Protection Agent', 0, 4);

-- Q2 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(2, 'SSL/TLS', 1, 1),
(2, 'FTP only', 0, 2),
(2, 'SMTP only', 0, 3),
(2, 'DNS only', 0, 4);

-- Q3 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(3, 'Users connect directly to apps, not the network', 1, 1),
(3, 'Faster VPN connections', 0, 2),
(3, 'More firewall rules', 0, 3),
(3, 'Bigger network bandwidth', 0, 4);

-- Category 2: Digital Experience (ZDX)
INSERT INTO questions (category_id, admin_id, question_text, sort_order) VALUES
(2, 1, 'What does ZDX stand for?', 1),
(2, 1, 'What does ZDX primarily monitor?', 2);

-- Q4 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(4, 'Zscaler Digital Experience', 1, 1),
(4, 'Zero Data Exchange', 0, 2),
(4, 'Zscaler DDoS eXterminator', 0, 3),
(4, 'Zone Defense eXpert', 0, 4);

-- Q5 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(5, 'End-to-end user experience and application performance', 1, 1),
(5, 'Only server CPU usage', 0, 2),
(5, 'Only network bandwidth', 0, 3),
(5, 'Only DNS resolution times', 0, 4);

-- Category 3: Branch & IoT/OT
INSERT INTO questions (category_id, admin_id, question_text, sort_order) VALUES
(3, 1, 'What is the Zscaler solution for branch office connectivity?', 1),
(3, 1, 'How does Zscaler protect IoT/OT devices?', 2);

-- Q6 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(6, 'Branch Connector', 1, 1),
(6, 'Branch VPN Hub', 0, 2),
(6, 'SD-WAN Router', 0, 3),
(6, 'MPLS Gateway', 0, 4);

-- Q7 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(7, 'By isolating IoT traffic and applying zero trust policies', 1, 1),
(7, 'By installing agents on every IoT device', 0, 2),
(7, 'By using traditional firewalls only', 0, 3),
(7, 'IoT devices cannot be protected', 0, 4);

-- Category 4: Data Protection (DLP)
INSERT INTO questions (category_id, admin_id, question_text, sort_order) VALUES
(4, 1, 'What type of data can Zscaler DLP detect?', 1),
(4, 1, 'Where does Zscaler DLP inspect data?', 2);

-- Q8 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(8, 'PII, financial data, intellectual property, and custom patterns', 1, 1),
(8, 'Only credit card numbers', 0, 2),
(8, 'Only email addresses', 0, 3),
(8, 'Only file names', 0, 4);

-- Q9 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(9, 'Inline (in transit) and at rest (SaaS apps, endpoints)', 1, 1),
(9, 'Only on the endpoint', 0, 2),
(9, 'Only in the data center', 0, 3),
(9, 'Only in email', 0, 4);

-- Category 5: Workload Protection
INSERT INTO questions (category_id, admin_id, question_text, sort_order) VALUES
(5, 1, 'What does Zscaler Workload Communications protect?', 1);

-- Q10 answers
INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES
(10, 'Cloud workload-to-workload and workload-to-internet traffic', 1, 1),
(10, 'Only virtual machines', 0, 2),
(10, 'Only containers', 0, 3),
(10, 'Only serverless functions', 0, 4);

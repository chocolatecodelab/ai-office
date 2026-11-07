CREATE TABLE production_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 brand_id text NOT NULL REFERENCES brands(id),
 agent_type text NOT NULL,
 title text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,brand_id,agent_type),
 FOREIGN KEY(brand_id,agent_type) REFERENCES agents(brand_id,agent_type)
);
CREATE TABLE production_versions (
 task_id uuid PRIMARY KEY REFERENCES production_jobs(task_id),
 project_id uuid NOT NULL,
 brand_id text NOT NULL,
 agent_type text NOT NULL,
 version integer NOT NULL CHECK(version>0),
 source_task_id uuid REFERENCES production_jobs(task_id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,version),
 FOREIGN KEY(project_id,brand_id,agent_type) REFERENCES production_projects(id,brand_id,agent_type)
);
-- Legacy outputs are independent projects; do not guess relationships from similar titles.
INSERT INTO production_projects(id,brand_id,agent_type,title,created_at)
SELECT p.task_id,p.brand_id,p.agent_type,coalesce(p.payload->'spec'->'slides'->0->>'headline',p.payload->>'title','Hasil produksi'),t.created_at
FROM production_jobs p JOIN tasks t ON t.id=p.task_id AND t.brand_id=p.brand_id;
INSERT INTO production_versions(task_id,project_id,brand_id,agent_type,version,created_at)
SELECT p.task_id,p.task_id,p.brand_id,p.agent_type,1,t.created_at FROM production_jobs p JOIN tasks t ON t.id=p.task_id AND t.brand_id=p.brand_id;
ALTER TABLE chat_inputs ADD COLUMN production_source_task_id uuid REFERENCES production_jobs(task_id);
CREATE INDEX production_project_scope ON production_projects(brand_id,agent_type,created_at DESC);

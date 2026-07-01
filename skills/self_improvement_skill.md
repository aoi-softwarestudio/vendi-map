# Agent Self-Improvement & Subordinate Management

## Purpose
This skill provides instructions for agents to self-improve their own skill files and define/manage specialized subordinates (subagents) to delegate tasks.

### 🧠 Core Philosophy
An agent should continuously learn from execution results (e.g., failed tasks, X algorithm changes, user feedback) and update their repository of skills to adapt.

### When to Use
Use this skill when:
- **Learnings Occur**: You discover a new way of working, a fix for a common error, or a change in X's algorithm.
- **Skill Review**: You want to check and improve your instructions under the `skills/` directory.
- **Task Delegation**: You need to define a specialized subagent for specific departmental tasks.

### 1. Self-Improvement of Skills
- **Edit Directly**: If you find that templates, instructions, or rules in any `.md` file in your department's `skills/` folder are outdated or can be improved, use `replace_file_content` or `multi_replace_file_content` to edit them directly.
- **Add New Skills**: If a new capability or pattern is identified (e.g. Stripe checkout updates, pSEO templates), create a new `.md` file under the `skills/` folder using `write_to_file`.
- **Refinement**: Regularly refine checklists and deliverables sections of the skill files based on testing feedback.

### 2. Subordinate Management (Defining Subagents)
- **Identify Specialization**: When a complex or long-running sub-task arises (e.g., deep competitor analysis, copy drafting, video rendering), define a specialized subagent.
- **Use `define_subagent`**: Define the subagent with:
  - `enable_write_tools = true` to allow them to create files and run commands.
  - `enable_subagent_tools = true` to allow them to manage further descendants.
- **Provide System Prompts**: Equip them with detailed prompts indicating their role and tell them to read and follow the skills located in their respective department's `skills/` folder.

### Checklist
- [ ] Have I reviewed the skills under my department's `skills/` directory after completing a task?
- [ ] Did I update relevant skill files with new lessons learned?
- [ ] If delegating, did I create a specialized subagent using `define_subagent`?

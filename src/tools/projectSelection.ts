import type { ProjectManager } from '../projects/ProjectManager';
import type { Project } from '../projects/types';

export interface ProjectScopedInput {
	project?: string;
}

export interface ResolvedToolProject {
	project?: Project;
	error?: string;
}

function formatProjectSummary(project: Project): string {
	const roots = project.rootPaths?.length ? ` | roots: ${project.rootPaths.join(', ')}` : '';
	return `- ${project.name} (ID: ${project.id})${roots}`;
}

function formatProjectList(projects: Project[]): string {
	return projects.map(formatProjectSummary).join('\n');
}

export function resolveToolProject(projectManager: ProjectManager, target?: string): ResolvedToolProject {
	const projects = projectManager.getAllProjects();
	if (projects.length === 0) {
		return {
			error: 'No ContextManager projects exist yet. Create a project in the dashboard first.',
		};
	}

	const trimmedTarget = target?.trim();
	if (trimmedTarget) {
		const resolved = projectManager.resolveProjectTarget(trimmedTarget);
		switch (resolved.status) {
			case 'resolved':
				return { project: resolved.project };
			case 'ambiguous':
				return {
					error: [
						`Project target "${trimmedTarget}" is ambiguous. Pass the exact project ID instead.`,
						'Matching projects:',
						formatProjectList(resolved.candidates),
					].join('\n'),
				};
			case 'not-found':
			default:
				return {
					error: [
						`Project target "${trimmedTarget}" was not found. Pass an exact project ID, exact project name, or exact workspace root path.`,
						'Available projects:',
						formatProjectList(projects),
					].join('\n'),
				};
		}
	}

	if (projects.length === 1) {
		return { project: projects[0] };
	}

	const activeProject = projectManager.getActiveProject();
	return {
		error: [
			'Multiple ContextManager projects are configured. Pass the `project` field explicitly using an exact project ID, exact project name, or exact workspace root path.',
			activeProject ? `Active project is currently "${activeProject.name}", but LM tools do not infer it in multi-project mode.` : 'There is no active-project fallback in multi-project mode.',
			'Available projects:',
			formatProjectList(projects),
		].join('\n'),
	};
}
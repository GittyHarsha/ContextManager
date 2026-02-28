/**
 * Sidebar TreeView provider for Projects
 */

import * as vscode from 'vscode';
import { ProjectManager } from '../projects/ProjectManager';
import { Project } from '../projects/types';

type TreeItemType = 
	| { type: 'project'; project: Project };

export class ProjectsTreeProvider implements vscode.TreeDataProvider<TreeItemType> {
	private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemType | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(
		private projectManager: ProjectManager
	) {
		// Refresh when projects change
		projectManager.onDidChangeProjects(() => this.refresh());
		projectManager.onDidChangeActiveProject(() => this.refresh());
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeItemType): vscode.TreeItem {
		return this.createProjectItem(element.project);
	}

	async getChildren(element?: TreeItemType): Promise<TreeItemType[]> {
		if (!element) {
			// Root level - show all projects
			return this.projectManager.getAllProjects().map(project => ({
				type: 'project' as const,
				project
			}));
		}

		return [];
	}

	private createProjectItem(project: Project): vscode.TreeItem {
		const isActive = this.projectManager.getActiveProject()?.id === project.id;
		const selectedCards = project.selectedCardIds?.length || 0;

		const item = new vscode.TreeItem(
			project.name,
			vscode.TreeItemCollapsibleState.None
		);

		item.description = `${selectedCards}/${project.knowledgeCards?.length || 0} cards`;
		item.iconPath = new vscode.ThemeIcon(isActive ? 'folder-opened' : 'folder');
		item.contextValue = isActive ? 'project-active' : 'project';
		
		// Don't activate on click - user can expand/collapse to see content
		// Activation is done via context menu button

		if (isActive) {
			item.description = `✓ ${item.description}`;
		}

		return item;
	}

}

/**
 * Register sidebar tree view and related commands
 */
export function registerSidebar(
	context: vscode.ExtensionContext,
	projectManager: ProjectManager
): ProjectsTreeProvider {
	const treeProvider = new ProjectsTreeProvider(projectManager);
	
	const treeView = vscode.window.createTreeView('contextManagerProjects', {
		treeDataProvider: treeProvider,
		showCollapseAll: true
	});

	context.subscriptions.push(treeView);

	// Register commands for tree actions
	context.subscriptions.push(
		vscode.commands.registerCommand('contextManager.refreshProjects', () => {
			treeProvider.refresh();
		}),

		vscode.commands.registerCommand('contextManager.createProject', async () => {
			const name = await vscode.window.showInputBox({
				prompt: 'Enter project name',
				placeHolder: 'My Project'
			});
			if (name) {
				const project = await projectManager.createProject(name);
				await projectManager.setActiveProject(project.id);
				vscode.window.showInformationMessage(`Created project: ${name}`);
			}
		}),

		vscode.commands.registerCommand('contextManager.deleteProject', async (item: TreeItemType) => {
			if (item.type !== 'project') {
				return;
			}
			const confirm = await vscode.window.showWarningMessage(
				`Delete project "${item.project.name}"?`,
				{ modal: true },
				'Delete'
			);
			if (confirm === 'Delete') {
				await projectManager.deleteProject(item.project.id);
				vscode.window.showInformationMessage(`Deleted project: ${item.project.name}`);
			}
		}),

		vscode.commands.registerCommand('contextManager.setActiveProject', async (itemOrId: TreeItemType | string) => {
			// Handle both direct projectId calls and context menu item calls
			const projectId = typeof itemOrId === 'string' ? itemOrId : 
							  itemOrId.type === 'project' ? itemOrId.project.id : undefined;
			
			if (!projectId) {
				return;
			}
			
			await projectManager.setActiveProject(projectId);
			const project = projectManager.getProject(projectId);
			if (project) {
				vscode.window.showInformationMessage(`Active project: ${project.name}`);
			}
		}),

		vscode.commands.registerCommand('contextManager.deselectProject', async () => {
			await projectManager.setActiveProject(undefined);
			vscode.window.showInformationMessage('No active project');
		})
	);

	return treeProvider;
}

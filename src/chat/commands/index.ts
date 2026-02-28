/**
 * Barrel re-export for all chat command handlers.
 */
export { handleChat, handleAnalysis, handleDoc } from './analysisCommands';
export { handleContext, handleAdd, handleSave, handleKnowledge, handleRefine } from './knowledgeCommands';
export { handleDone, handleHandoff, handleAudit, handleMap, handleTodo } from './workflowCommands';

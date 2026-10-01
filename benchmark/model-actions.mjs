export class InvalidModelAction extends Error {}
export function responseActionError(data) {
 const choice=data?.choices?.[0];
 if(choice?.finish_reason==='content_filter'||choice?.finish_reason==='refusal'||choice?.message?.refusal) return new InvalidModelAction('Model refused the action.');
 return null;
}
export function isInvalidModelAction(error) {
 return error instanceof InvalidModelAction || error instanceof SyntaxError;
}
export function actionFailureMessage(error) {
 return error instanceof SyntaxError ? 'Model returned malformed JSON.' : error.message;
}

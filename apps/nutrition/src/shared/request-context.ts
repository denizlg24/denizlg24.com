interface RequestContext {
  requestId: string;
  startedAt: number;
}

const contexts = new WeakMap<Request, RequestContext>();

export const setRequestContext = (
  request: Request,
  context: RequestContext,
) => {
  contexts.set(request, context);
};

export const getRequestContext = (request: Request) => contexts.get(request);

/**
 * Performs an HTTP request using XMLHttpRequest and returns a Promise resolving to a Response.
 *
 * @param {string} url - The URL to request.
 * @param {Object} [options] - Optional settings for the request.
 * @param {string} [options.method] - HTTP method to use (e.g. "GET", "POST").
 * @param {Object.<string, string>} [options.headers] - Headers to set on the request.
 * @param {string} [options.credentials] - Whether to send cookies with the request ("include" to send).
 * @param {BodyInit | null} [options.body] - The body of the request, for methods like POST.
 * @returns {Promise<Response>} Promise resolving to a Response object containing the response text and status.
 */
export default async function request(
	url: string,
	options: {
		method?: string;
		headers?: Record<string, string>;
		credentials?: string;
		body?: BodyInit | null;
	} = {},
): Promise<Response> {
	return new Promise(function (resolve, reject) {
		const xhr = new XMLHttpRequest();

		xhr.open(options.method || "get", url, true);

		for (const header in options.headers) {
			xhr.setRequestHeader(header, options.headers[header]);
		}

		xhr.withCredentials = options.credentials === "include";

		xhr.onload = () => {
			// Chrome returns a status code of 0 for local files
			const status =
				xhr.status === 0 && url.startsWith("file://") ? 200 : xhr.status;
			resolve(new Response(xhr.responseText, { status }));
		};

		xhr.onerror = reject;

		xhr.send((options.body as XMLHttpRequestBodyInit | null) || null);
	});
}

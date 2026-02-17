export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    const telegraphPath = `${url.pathname}${url.search}`;
    const filePath = await resolveTelegramFilePath(env, params.id);
    const fileUrl = filePath
        ? `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`
        : `https://telegra.ph${telegraphPath}`;

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return response;
    }

    if (!env.img_url) {
        console.log('KV storage not available, returning file directly');
        return response;
    }

    let record = await env.img_url.getWithMetadata(params.id);
    if (!record || !record.metadata) {
        record = {
            metadata: {
                ListType: 'None',
                Label: 'None',
                TimeStamp: Date.now(),
                liked: false,
                fileName: params.id,
                fileSize: 0,
            }
        };
        await env.img_url.put(params.id, '', { metadata: record.metadata });
    }

    const metadata = {
        ListType: record.metadata.ListType || 'None',
        Label: record.metadata.Label || 'None',
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
        fileName: record.metadata.fileName || params.id,
        fileSize: record.metadata.fileSize || 0,
    };

    if (metadata.ListType === 'White') {
        return response;
    }

    if (metadata.ListType === 'Block' || metadata.Label === 'adult') {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer
            ? 'https://static-res.pages.dev/teleimage/img-block-compressed.png'
            : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    if (env.WhiteList_Mode === 'true') {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    if (env.ModerateContentApiKey && isImageRequest(response.headers.get('content-type'))) {
        try {
            const encodedFileUrl = encodeURIComponent(fileUrl);
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=${encodedFileUrl}`;
            const moderateResponse = await fetch(moderateUrl);

            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();

                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;

                    if (moderateData.rating_label === 'adult') {
                        await env.img_url.put(params.id, '', { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            } else {
                console.error(`Content moderation API request failed: ${moderateResponse.status}`);
            }
        } catch (error) {
            console.error(`Error during content moderation: ${error.message}`);
        }
    }

    await env.img_url.put(params.id, '', { metadata });

    return response;
}

function isImageRequest(contentType = '') {
    return contentType.toLowerCase().startsWith('image/');
}

async function resolveTelegramFilePath(env, id) {
    const candidates = buildFileIdCandidates(id);

    for (const fileId of candidates) {
        const filePath = await getFilePath(env, fileId);
        if (filePath) {
            return filePath;
        }
    }

    return null;
}

function buildFileIdCandidates(id) {
    const candidates = [id];
    const dotIndex = id.lastIndexOf('.');

    if (dotIndex > 0) {
        const ext = id.slice(dotIndex + 1).toLowerCase();
        if (/^[a-z0-9]{1,10}$/.test(ext)) {
            candidates.push(id.slice(0, dotIndex));
        }
    }

    return [...new Set(candidates)];
}

async function getFilePath(env, fileId) {
    try {
        const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${encodeURIComponent(fileId)}`;
        const res = await fetch(apiUrl, { method: 'GET' });

        if (!res.ok) {
            return null;
        }

        const responseData = await res.json();
        const { ok, result } = responseData;

        if (ok && result && result.file_path) {
            return result.file_path;
        }

        return null;
    } catch (error) {
        console.error(`Error fetching file path: ${error.message}`);
        return null;
    }
}

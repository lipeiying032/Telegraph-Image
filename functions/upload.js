import { errorHandling, telemetryData } from "./utils/middleware";

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const clonedRequest = request.clone();
        const formData = await clonedRequest.formData();

        await errorHandling(context);
        telemetryData(context);

        const uploadFile = formData.get('file');
        if (!uploadFile) {
            throw new Error('No file uploaded');
        }

        const fileName = uploadFile.name || 'upload.bin';
        const fileExtension = getFileExtension(fileName);

        const telegramFormData = new FormData();
        telegramFormData.append("chat_id", env.TG_Chat_ID);

        // 根据文件 MIME 类型选择合适的 Telegram API 接口
        let apiEndpoint;
        const mimeType = uploadFile.type;

        if (mimeType.startsWith('image/')) {
            // 图片文件：使用 sendPhoto
            telegramFormData.append("photo", uploadFile);
            apiEndpoint = 'sendPhoto';
        } else if (mimeType.startsWith('video/')) {
            // 视频文件：使用 sendVideo
            telegramFormData.append("video", uploadFile);
            apiEndpoint = 'sendVideo';
        } else if (mimeType.startsWith('audio/')) {
            // 音频文件：使用 sendAudio
            telegramFormData.append("audio", uploadFile);
            apiEndpoint = 'sendAudio';
        } else {
            // 其他所有类型：使用 sendDocument（支持 .zip, .pdf, .exe 等）
            telegramFormData.append("document", uploadFile);
            apiEndpoint = 'sendDocument';
        }

        const result = await sendToTelegram(telegramFormData, apiEndpoint, env);

        if (!result.success) {
            throw new Error(result.error);
        }

        const fileId = getFileId(result.data);

        if (!fileId) {
            throw new Error('Failed to get file ID from Telegram response');
        }

        // 将文件信息保存到 KV 存储
        const storageId = fileExtension ? `${fileId}.${fileExtension}` : fileId;

        if (env.img_url) {
            await env.img_url.put(storageId, "", {
                metadata: {
                    TimeStamp: Date.now(),
                    ListType: "None",
                    Label: "None",
                    liked: false,
                    fileName: fileName,
                    fileSize: uploadFile.size,
                    mimeType: mimeType || 'application/octet-stream',
                }
            });
        }

        return new Response(
            JSON.stringify([{ 'src': `/file/${storageId}` }]),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    } catch (error) {
        console.error('Upload error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

function getFileExtension(fileName) {
    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

/**
 * 从 Telegram API 响应中提取 file_id
 * 按照优先级顺序检查：photo → document → video → audio
 */
function getFileId(response) {
    if (!response.ok || !response.result) {
        console.error('Invalid Telegram response:', response);
        return null;
    }

    const result = response.result;

    // 优先级 1: 检查 photo（数组类型，取最大尺寸）
    if (result.photo && Array.isArray(result.photo) && result.photo.length > 0) {
        return result.photo.reduce((prev, current) =>
            (prev.file_size > current.file_size) ? prev : current
        ).file_id;
    }

    // 优先级 2: 检查 document
    if (result.document && result.document.file_id) {
        return result.document.file_id;
    }

    // 优先级 3: 检查 video
    if (result.video && result.video.file_id) {
        return result.video.file_id;
    }

    // 优先级 4: 检查 audio
    if (result.audio && result.audio.file_id) {
        return result.audio.file_id;
    }

    console.error('No file_id found in response:', result);
    return null;
}

/**
 * 发送文件到 Telegram，带自动重试机制
 */
async function sendToTelegram(formData, apiEndpoint, env, retryCount = 0) {
    const MAX_RETRIES = 2;
    const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/${apiEndpoint}`;

    try {
        const response = await fetch(apiUrl, { 
            method: "POST", 
            body: formData 
        });
        const responseData = await response.json();

        if (response.ok) {
            return { success: true, data: responseData };
        }

        // 图片上传失败时转为文档方式重试（某些图片格式 Telegram 不支持作为 photo）
        if (retryCount < MAX_RETRIES && apiEndpoint === 'sendPhoto') {
            console.log('Retrying image as document...');
            const newFormData = new FormData();
            newFormData.append('chat_id', formData.get('chat_id'));
            newFormData.append('document', formData.get('photo'));
            return await sendToTelegram(newFormData, 'sendDocument', env, retryCount + 1);
        }

        return {
            success: false,
            error: responseData.description || `Telegram API error: ${response.status}`
        };
    } catch (error) {
        console.error('Network error:', error);
        
        // 网络错误时重试（指数退避）
        if (retryCount < MAX_RETRIES) {
            const delay = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s
            await new Promise(resolve => setTimeout(resolve, delay));
            return await sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
        }
        
        return { 
            success: false, 
            error: `Network error: ${error.message}` 
        };
    }
}

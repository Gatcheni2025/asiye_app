/* ============================================================
   ASIYE PHP IMAGE UPLOADER
   Native/web camera bytes -> multipart/form-data -> upload_handler.php
   ============================================================ */
window.AsiyePhpImageUpload = {
    endpoint:
        'https://app.asiye.cloud/upload_handler.php',

    endpoints: [
        'https://app.asiye.cloud/upload_handler.php',
        'https://app.asiye.cloud/server/upload_handler.php'
    ],

    apiKey:
        'asiye_secure_upload_2025',

    dataUrlToBlob(dataUrl) {
        if (
            typeof dataUrl !== 'string' ||
            !dataUrl.startsWith('data:')
        ) {
            throw new Error(
                'The camera did not return a valid image.'
            );
        }

        const comma =
            dataUrl.indexOf(',');

        if (comma < 0) {
            throw new Error(
                'The captured image is incomplete.'
            );
        }

        const meta =
            dataUrl.slice(0, comma);

        const payload =
            dataUrl.slice(comma + 1);

        const mime =
            meta.match(
                /^data:([^;,]+)/
            )?.[1] ||
            'image/jpeg';

        let bytes;

        if (
            meta.includes(
                ';base64'
            )
        ) {
            const binary =
                atob(payload);

            bytes =
                new Uint8Array(
                    binary.length
                );

            for (
                let index = 0;
                index < binary.length;
                index++
            ) {
                bytes[index] =
                    binary.charCodeAt(
                        index
                    );
            }
        } else {
            const decoded =
                decodeURIComponent(
                    payload
                );

            bytes =
                new TextEncoder()
                    .encode(
                        decoded
                    );
        }

        return new Blob(
            [bytes],
            {
                type:
                    mime
            }
        );
    },

    toBlob(input) {
        if (
            input instanceof Blob
        ) {
            return input;
        }

        if (
            input?.dataUrl
        ) {
            return this.dataUrlToBlob(
                input.dataUrl
            );
        }

        throw new Error(
            'No captured image was supplied.'
        );
    },

    compressProfileImage(
        blob,
        {
            maxSide = 720,
            quality = 0.72
        } = {}
    ) {
        if (
            !blob ||
            !String(
                blob.type || ''
            ).startsWith(
                'image/'
            )
        ) {
            return Promise.resolve(
                blob
            );
        }

        return new Promise(
            resolve => {
                const reader =
                    new FileReader();

                reader.onerror =
                    () => resolve(
                        blob
                    );

                reader.onload =
                    event => {
                        const image =
                            new Image();

                        image.onerror =
                            () => resolve(
                                blob
                            );

                        image.onload =
                            () => {
                                const originalWidth =
                                    image.naturalWidth ||
                                    image.width;

                                const originalHeight =
                                    image.naturalHeight ||
                                    image.height;

                                if (
                                    !originalWidth ||
                                    !originalHeight
                                ) {
                                    resolve(
                                        blob
                                    );
                                    return;
                                }

                                const scale =
                                    Math.min(
                                        1,
                                        maxSide /
                                            Math.max(
                                                originalWidth,
                                                originalHeight
                                            )
                                    );

                                const width =
                                    Math.max(
                                        1,
                                        Math.round(
                                            originalWidth *
                                            scale
                                        )
                                    );

                                const height =
                                    Math.max(
                                        1,
                                        Math.round(
                                            originalHeight *
                                            scale
                                        )
                                    );

                                const canvas =
                                    document.createElement(
                                        'canvas'
                                    );

                                canvas.width =
                                    width;

                                canvas.height =
                                    height;

                                const context =
                                    canvas.getContext(
                                        '2d'
                                    );

                                if (!context) {
                                    resolve(
                                        blob
                                    );
                                    return;
                                }

                                context.drawImage(
                                    image,
                                    0,
                                    0,
                                    width,
                                    height
                                );

                                canvas.toBlob(
                                    compressed => {
                                        if (
                                            compressed &&
                                            compressed.size > 0 &&
                                            compressed.size <
                                                blob.size
                                        ) {
                                            resolve(
                                                compressed
                                            );
                                            return;
                                        }

                                        resolve(
                                            blob
                                        );
                                    },
                                    'image/jpeg',
                                    quality
                                );
                            };

                        image.src =
                            event.target.result;
                    };

                reader.readAsDataURL(
                    blob
                );
            }
        );
    },

    buildFormData(
        blob,
        {
            userId,
            purpose,
            filename
        }
    ) {
        const formData =
            new FormData();

        formData.append(
            'file',
            blob,
            filename
        );

        formData.append(
            'api_key',
            this.apiKey
        );

        formData.append(
            'userId',
            String(userId)
        );

        formData.append(
            'purpose',
            String(purpose)
        );

        return formData;
    },

    async uploadToEndpoint(
        endpoint,
        blob,
        options
    ) {
        const controller =
            typeof AbortController !== 'undefined'
                ? new AbortController()
                : null;

        const timeout =
            controller
                ? setTimeout(
                    () => controller.abort(),
                    30000
                )
                : null;

        try {
            const response =
                await fetch(
                    endpoint,
                    {
                        method:
                            'POST',
                        body:
                            this.buildFormData(
                                blob,
                                options
                            ),
                        cache:
                            'no-store',
                        signal:
                            controller?.signal
                    }
                );

            const raw =
                await response.text();

            let data = {};

            if (raw) {
                try {
                    data =
                        JSON.parse(raw);
                } catch (_) {
                    /*
                     * A 404/500 page from shared hosting is often HTML.
                     * Surface the HTTP status instead of the vague
                     * "Failed to fetch" / "invalid response" message.
                     */
                    if (!response.ok) {
                        const error =
                            new Error(
                                `Image server returned HTTP ${response.status} at ${endpoint}.`
                            );

                        error.httpStatus =
                            response.status;

                        error.endpoint =
                            endpoint;

                        throw error;
                    }

                    throw new Error(
                        `Image server returned an invalid response from ${endpoint}.`
                    );
                }
            }

            const url =
                data?.url ||
                data?.file_url ||
                data?.fileUrl ||
                data?.location ||
                '';

            if (
                !response.ok ||
                !url ||
                (
                    data.status &&
                    ![
                        'success',
                        'ok'
                    ].includes(
                        String(
                            data.status
                        ).toLowerCase()
                    )
                )
            ) {
                const error =
                    new Error(
                        data?.message ||
                        data?.error ||
                        `The image server rejected the upload (HTTP ${response.status}).`
                    );

                error.httpStatus =
                    response.status;

                error.endpoint =
                    endpoint;

                throw error;
            }

            return {
                url,
                data,
                blob,
                endpoint
            };
        } catch (error) {
            if (
                error?.name ===
                'AbortError'
            ) {
                const timeoutError =
                    new Error(
                        `Image upload timed out while contacting ${endpoint}.`
                    );

                timeoutError.endpoint =
                    endpoint;

                throw timeoutError;
            }

            if (
                error instanceof TypeError &&
                /fetch/i.test(
                    String(
                        error.message ||
                        ''
                    )
                )
            ) {
                const networkError =
                    new Error(
                        `Image server could not be reached at ${endpoint}.`
                    );

                networkError.endpoint =
                    endpoint;

                throw networkError;
            }

            throw error;
        } finally {
            if (timeout) {
                clearTimeout(
                    timeout
                );
            }
        }
    },

    async upload(
        input,
        {
            userId,
            purpose = 'image',
            filename = 'asiye-capture.jpg'
        } = {}
    ) {
        if (!userId) {
            throw new Error(
                'The user account is not ready for image upload.'
            );
        }

        let blob =
            this.toBlob(input);

        if (
            !String(
                blob.type || ''
            ).startsWith(
                'image/'
            )
        ) {
            throw new Error(
                'The captured scan is not a supported image.'
            );
        }

        if (
            !blob.size ||
            blob.size >
                15 * 1024 * 1024
        ) {
            throw new Error(
                'The captured image is empty or too large.'
            );
        }

        /*
         * Face/profile captures are identity thumbnails, not source
         * documents. Resize them before the network request so mobile
         * uploads stay fast even when the native camera captures a
         * multi-megapixel JPEG.
         */
        if (
            blob.size >
                350 * 1024 &&
            /profile|selfie|face/i.test(
                String(
                    purpose
                )
            )
        ) {
            blob =
                await this
                    .compressProfileImage(
                        blob
                    );
        }

        const options = {
            userId,
            purpose,
            filename
        };

        const endpoints =
            Array.from(
                new Set(
                    [
                        this.endpoint,
                        ...(this.endpoints || [])
                    ].filter(Boolean)
                )
            );

        let lastError = null;

        for (
            const endpoint
            of endpoints
        ) {
            try {
                const uploaded =
                    await this.uploadToEndpoint(
                        endpoint,
                        blob,
                        options
                    );

                /*
                 * Remember the working endpoint for any later upload in
                 * the same app session.
                 */
                this.endpoint =
                    endpoint;

                return uploaded;
            } catch (error) {
                lastError =
                    error;

                console.warn(
                    'Asiye image upload endpoint failed:',
                    endpoint,
                    error
                );

                /*
                 * These statuses prove that the endpoint exists and the
                 * request reached PHP. Falling back would hide the real
                 * server-side problem, so stop here.
                 */
                if (
                    [
                        400,
                        401,
                        403,
                        413,
                        415
                    ].includes(
                        Number(
                            error?.httpStatus
                        )
                    )
                ) {
                    throw error;
                }
            }
        }

        throw new Error(
            lastError?.message ||
            'Image server is unavailable. Make sure upload_handler.php is deployed on app.asiye.cloud.'
        );
    }
};

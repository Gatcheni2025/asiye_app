/* ============================================================
   ASIYE PHP IMAGE UPLOADER
   Native/web camera bytes -> multipart/form-data -> upload_handler.php
   ============================================================ */
window.AsiyePhpImageUpload = {
    endpoint:
        'https://app.asiye.cloud/upload_handler.php',

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

        const blob =
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

        /*
         * Existing PHP ignores unknown fields safely, while newer
         * handlers can use purpose to keep captures organised.
         */
        formData.append(
            'purpose',
            String(purpose)
        );

        const response =
            await fetch(
                this.endpoint,
                {
                    method:
                        'POST',
                    body:
                        formData
                }
            );

        const raw =
            await response.text();

        let data = {};

        try {
            data =
                raw
                    ? JSON.parse(raw)
                    : {};
        } catch (_) {
            throw new Error(
                'The image server returned an invalid response.'
            );
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
            throw new Error(
                data?.message ||
                data?.error ||
                'The captured image could not be saved.'
            );
        }

        return {
            url,
            data,
            blob
        };
    }
};

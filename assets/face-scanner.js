/* ============================================================
   ASIYE LIVE FACE SCANNER
   In-app camera preview -> guided capture -> JPEG Blob
   ============================================================ */

window.AsiyeFaceScanner = {
    stream: null,
    overlay: null,
    resolver: null,

    async open({
        title = 'Face scan',
        subtitle = 'Position your face inside the guide and look straight at the camera.'
    } = {}) {
        this.close(false);

        if (
            !navigator.mediaDevices ||
            typeof navigator.mediaDevices
                .getUserMedia !==
                'function'
        ) {
            throw new Error(
                'Live camera scanning is unavailable on this device.'
            );
        }

        const overlay =
            document.createElement(
                'div'
            );

        overlay.className =
            'asiye-face-scan';

        overlay.innerHTML = `
            <section
                class="asiye-face-scan-card"
                role="dialog"
                aria-modal="true"
                aria-label="${this.escape(title)}"
            >
                <header>
                    <div>
                        <small>ASIYE VERIFICATION</small>
                        <h2>${this.escape(title)}</h2>
                        <p>${this.escape(subtitle)}</p>
                    </div>

                    <button
                        type="button"
                        data-face-close
                        aria-label="Close face scanner"
                    >
                        <i class="fas fa-times"></i>
                    </button>
                </header>

                <div class="asiye-face-camera">
                    <video
                        data-face-video
                        autoplay
                        playsinline
                        muted
                    ></video>

                    <div
                        class="asiye-face-guide"
                        aria-hidden="true"
                    >
                        <span></span>
                    </div>

                    <div class="asiye-face-camera-tip">
                        Keep your face centred and remove sunglasses or hats.
                    </div>
                </div>

                <div
                    class="asiye-face-status"
                    data-face-status
                    role="status"
                >
                    Starting front camera…
                </div>

                <div class="asiye-face-actions">
                    <button
                        type="button"
                        class="asiye-face-cancel"
                        data-face-cancel
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        class="asiye-face-capture"
                        data-face-capture
                        disabled
                    >
                        <span class="asiye-face-shutter"></span>
                        Capture face
                    </button>
                </div>
            </section>
        `;

        document.body.appendChild(
            overlay
        );

        this.overlay =
            overlay;

        const video =
            overlay.querySelector(
                '[data-face-video]'
            );

        const status =
            overlay.querySelector(
                '[data-face-status]'
            );

        const capture =
            overlay.querySelector(
                '[data-face-capture]'
            );

        overlay
            .querySelector(
                '[data-face-close]'
            )
            .onclick =
            () => this.close(
                true
            );

        overlay
            .querySelector(
                '[data-face-cancel]'
            )
            .onclick =
            () => this.close(
                true
            );

        const result =
            new Promise(
                resolve => {
                    this.resolver =
                        resolve;
                }
            );

        try {
            this.stream =
                await navigator
                    .mediaDevices
                    .getUserMedia({
                        audio:
                            false,

                        video: {
                            facingMode:
                                'user',

                            width: {
                                ideal:
                                    1280
                            },

                            height: {
                                ideal:
                                    1280
                            }
                        }
                    });

            video.srcObject =
                this.stream;

            await video.play();

            const ready =
                () => {
                    if (
                        video.videoWidth >
                            0 &&
                        video.videoHeight >
                            0
                    ) {
                        capture.disabled =
                            false;

                        status.textContent =
                            'Face detected area ready. Tap Capture face when you are centred.';
                    }
                };

            if (
                video.readyState >=
                2
            ) {
                ready();
            } else {
                video.onloadedmetadata =
                    ready;
            }

            capture.onclick =
                async () => {
                    capture.disabled =
                        true;

                    status.textContent =
                        'Capturing face…';

                    try {
                        const blob =
                            await this.capture(
                                video
                            );

                        status.textContent =
                            'Face captured. Saving…';

                        const resolve =
                            this.resolver;

                        this.destroy();

                        resolve?.({
                            blob,
                            mimeType:
                                'image/jpeg',
                            name:
                                'asiye-face-scan.jpg'
                        });
                    } catch (error) {
                        capture.disabled =
                            false;

                        status.textContent =
                            error?.message ||
                            'Could not capture your face. Try again.';
                    }
                };

        } catch (error) {
            this.destroy();

            throw new Error(
                error?.name ===
                    'NotAllowedError'
                    ? 'Camera access is required for face scan. Allow Camera permission for Asiye and try again.'
                    : 'Unable to start the front camera. Check camera permission and try again.'
            );
        }

        return result;
    },


    capture(video) {
        return new Promise(
            (
                resolve,
                reject
            ) => {
                const sourceWidth =
                    Number(
                        video.videoWidth
                    );

                const sourceHeight =
                    Number(
                        video.videoHeight
                    );

                if (
                    !sourceWidth ||
                    !sourceHeight
                ) {
                    reject(
                        new Error(
                            'The camera is not ready yet.'
                        )
                    );

                    return;
                }

                /*
                 * Square centre crop is ideal for driver/passenger
                 * avatars and keeps the face guide aligned.
                 */
                const crop =
                    Math.min(
                        sourceWidth,
                        sourceHeight
                    );

                const sx =
                    Math.max(
                        0,
                        (
                            sourceWidth -
                            crop
                        ) /
                        2
                    );

                const sy =
                    Math.max(
                        0,
                        (
                            sourceHeight -
                            crop
                        ) /
                        2
                    );

                const canvas =
                    document.createElement(
                        'canvas'
                    );

                canvas.width =
                    800;

                canvas.height =
                    800;

                const context =
                    canvas.getContext(
                        '2d'
                    );

                /*
                 * Mirror the saved image the same way the user
                 * sees the front camera preview.
                 */
                context.translate(
                    canvas.width,
                    0
                );

                context.scale(
                    -1,
                    1
                );

                context.drawImage(
                    video,
                    sx,
                    sy,
                    crop,
                    crop,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                canvas.toBlob(
                    blob => {
                        if (!blob) {
                            reject(
                                new Error(
                                    'Face capture could not be prepared.'
                                )
                            );

                            return;
                        }

                        resolve(
                            blob
                        );
                    },
                    'image/jpeg',
                    .84
                );
            }
        );
    },


    close(cancelled = true) {
        if (!this.overlay) {
            return;
        }

        const resolve =
            this.resolver;

        this.destroy();

        if (cancelled) {
            resolve?.(
                null
            );
        }
    },


    destroy() {
        if (this.stream) {
            this.stream
                .getTracks()
                .forEach(
                    track =>
                        track.stop()
                );
        }

        this.stream =
            null;

        this.overlay
            ?.remove?.();

        this.overlay =
            null;

        this.resolver =
            null;
    },


    escape(value) {
        return String(
            value ??
            ''
        ).replace(
            /[&<>"']/g,
            character => ({
                '&':
                    '&amp;',
                '<':
                    '&lt;',
                '>':
                    '&gt;',
                '"':
                    '&quot;',
                "'":
                    '&#39;'
            })[character]
        );
    }
};

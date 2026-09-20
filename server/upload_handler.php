<?php
declare(strict_types=1);

/*
 * Asiye image upload endpoint.
 *
 * Deploy this file as:
 *   https://app.asiye.cloud/upload_handler.php
 *
 * Optional server environment variable:
 *   ASIYE_UPLOAD_API_KEY
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/*
 * The packaged Flutter WebView loads local assets, so its Origin may be
 * "null" rather than https://app.asiye.cloud. This endpoint does not use
 * cookie credentials; the upload API key is validated below. Allowing all
 * origins lets Android/iOS app captures reach this PHP endpoint reliably.
 */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES |
        JSON_UNESCAPED_UNICODE
    );
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, [
        'status' => 'error',
        'error' => 'Method not allowed',
    ]);
}

$expectedApiKey =
    getenv('ASIYE_UPLOAD_API_KEY') ?:
    'asiye_secure_upload_2025';

$providedApiKey =
    trim((string)($_POST['api_key'] ?? ''));

if (
    $expectedApiKey === '' ||
    $providedApiKey === '' ||
    !hash_equals($expectedApiKey, $providedApiKey)
) {
    respond(401, [
        'status' => 'error',
        'error' => 'Invalid upload credentials',
    ]);
}

if (
    !isset($_FILES['file']) ||
    !is_array($_FILES['file'])
) {
    respond(400, [
        'status' => 'error',
        'error' => 'No image file was received',
    ]);
}

$file = $_FILES['file'];
$error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);

if ($error !== UPLOAD_ERR_OK) {
    $messages = [
        UPLOAD_ERR_INI_SIZE => 'Image exceeds server upload limit',
        UPLOAD_ERR_FORM_SIZE => 'Image exceeds form upload limit',
        UPLOAD_ERR_PARTIAL => 'Image upload was interrupted',
        UPLOAD_ERR_NO_FILE => 'No image was received',
        UPLOAD_ERR_NO_TMP_DIR => 'Server temporary folder is unavailable',
        UPLOAD_ERR_CANT_WRITE => 'Server could not save the image',
        UPLOAD_ERR_EXTENSION => 'Server rejected the image upload',
    ];

    respond(400, [
        'status' => 'error',
        'error' =>
            $messages[$error] ??
            'Image upload failed',
        'code' => $error,
    ]);
}

$tmpPath =
    (string)($file['tmp_name'] ?? '');

if (
    $tmpPath === '' ||
    !is_uploaded_file($tmpPath)
) {
    respond(400, [
        'status' => 'error',
        'error' => 'Uploaded image is invalid',
    ]);
}

$size =
    (int)($file['size'] ?? 0);

$maxBytes =
    15 * 1024 * 1024;

if (
    $size <= 0 ||
    $size > $maxBytes
) {
    respond(413, [
        'status' => 'error',
        'error' => 'Image must be between 1 byte and 15 MB',
    ]);
}

$finfo =
    new finfo(FILEINFO_MIME_TYPE);

$mime =
    (string)$finfo->file($tmpPath);

$extensions = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
];

if (!isset($extensions[$mime])) {
    respond(415, [
        'status' => 'error',
        'error' => 'Only JPG, PNG and WebP images are supported',
    ]);
}

$userId =
    preg_replace(
        '/[^A-Za-z0-9_-]/',
        '_',
        (string)($_POST['userId'] ?? 'anonymous')
    );

$purpose =
    preg_replace(
        '/[^A-Za-z0-9_-]/',
        '_',
        (string)($_POST['purpose'] ?? 'image')
    );

$userId =
    $userId !== ''
        ? substr($userId, 0, 100)
        : 'anonymous';

$purpose =
    $purpose !== ''
        ? substr($purpose, 0, 80)
        : 'image';

$uploadRoot =
    __DIR__ .
    DIRECTORY_SEPARATOR .
    'uploads';

$userDirectory =
    $uploadRoot .
    DIRECTORY_SEPARATOR .
    $userId;

if (
    !is_dir($userDirectory) &&
    !mkdir(
        $userDirectory,
        0755,
        true
    ) &&
    !is_dir($userDirectory)
) {
    respond(500, [
        'status' => 'error',
        'error' => 'Upload directory could not be created',
    ]);
}

try {
    $random =
        bin2hex(
            random_bytes(10)
        );
} catch (Throwable $error) {
    $random =
        str_replace(
            '.',
            '',
            uniqid('', true)
        );
}

$filename =
    sprintf(
        '%s_%s_%s.%s',
        $purpose,
        gmdate('Ymd_His'),
        $random,
        $extensions[$mime]
    );

$destination =
    $userDirectory .
    DIRECTORY_SEPARATOR .
    $filename;

if (
    !move_uploaded_file(
        $tmpPath,
        $destination
    )
) {
    respond(500, [
        'status' => 'error',
        'error' => 'Server could not store the captured image',
    ]);
}

@chmod(
    $destination,
    0644
);

$isHttps =
    (
        isset($_SERVER['HTTPS']) &&
        $_SERVER['HTTPS'] !== '' &&
        strtolower((string)$_SERVER['HTTPS']) !== 'off'
    ) ||
    (
        (string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
    );

$scheme =
    $isHttps
        ? 'https'
        : 'http';

$host =
    (string)($_SERVER['HTTP_HOST'] ?? 'app.asiye.cloud');

$scriptDirectory =
    trim(
        str_replace(
            '\\',
            '/',
            dirname(
                (string)($_SERVER['SCRIPT_NAME'] ?? '/upload_handler.php')
            )
        ),
        '/'
    );

$relativeUrl =
    ($scriptDirectory !== ''
        ? '/' . $scriptDirectory
        : '') .
    '/uploads/' .
    rawurlencode($userId) .
    '/' .
    rawurlencode($filename);

$url =
    $scheme .
    '://' .
    $host .
    $relativeUrl;

respond(200, [
    'status' => 'success',
    'url' => $url,
    'file_url' => $url,
    'mime_type' => $mime,
    'size' => $size,
    'purpose' => $purpose,
]);

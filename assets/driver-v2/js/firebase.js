/* ============================================================
   ASIYE PASSENGER V2
   FIREBASE INITIALIZATION
   ============================================================ */

window.ASIYE =
    window.ASIYE || {};


/*
 * IMPORTANT:
 *
 * Copy the SAME Firebase Web configuration
 * from your existing working Asiye app.
 *
 * Firebase Web API keys are client configuration,
 * but your Realtime Database / Firestore rules
 * must still protect your data.
 */

  const firebaseConfig = {
              apiKey: "AIzaSyCX_euO2EEPhfhuG5DTsSi5vCpZ9MFZczY",
              authDomain: "asiye-80386.firebaseapp.com",
              databaseURL: "https://asiye-80386-default-rtdb.firebaseio.com",
              projectId: "asiye-80386",
              storageBucket: "asiye-80386.firebasestorage.app",
              appId: "1:531902350858:web:f8a4a246bf350d50e3c1f3"
          };

/* ============================================================
   INITIALIZE ONLY ONCE
   ============================================================ */

try {

    if (
        typeof firebase ===
        "undefined"
    ) {

        throw new Error(
            "Firebase SDK has not loaded."
        );
    }


    if (
        firebase.apps &&
        firebase.apps.length > 0
    ) {

        ASIYE.firebaseApp =
            firebase.app();


        console.log(
            "✅ Existing Firebase app reused"
        );

    } else {

        ASIYE.firebaseApp =

            firebase.initializeApp(
                ASIYE_FIREBASE_CONFIG
            );


        console.log(
            "✅ Firebase initialized"
        );
    }


    /* ========================================================
       FIREBASE SERVICES
       ======================================================== */

    ASIYE.auth =
        firebase.auth();


    ASIYE.database =
        firebase.database();


    ASIYE.storage =
        firebase.storage();


    window.database =
        ASIYE.database;


    console.log(
        "✅ Firebase Realtime Database ready"
    );


} catch (error) {

    console.error(
        "❌ Firebase initialization failed:",
        error
    );


    window.ASIYE_FIREBASE_ERROR =
        error;
}
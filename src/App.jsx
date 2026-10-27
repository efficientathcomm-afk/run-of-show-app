import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

// Exact Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyAgf7qX4HarmphjjhhTcj0m_mW5SzYYGMk",
  authDomain: "run-of-show-790f7.firebaseapp.com",
  projectId: "run-of-show-790f7",
  storageBucket: "run-of-show-790f7.firebasestorage.app",
  messagingSenderId: "459921558596",
  appId: "1:459921558596:web:42113bdfe5e782e2870011",
  measurementId: "G-JXKR1JSF24"
};

// Initialize Firebase Services safely with fallback for preview environment
let app = null;
let auth = null;
let db = null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-run-of-show-app';

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.log("Running in offline/local fallback mode due to initialization error:", e);
}

export default function App() {
  // Authentication & User State
  const [user, setUser] = useState(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("Connecting to Firebase...");

  // App Navigation / Mode State ("list" | "editor" | "teleprompter" | "repository")
  const [currentView, setCurrentView] = useState("list");
  const [showsList, setShowsList] = useState([]);
  const [activeShowId, setActiveShowId] = useState(null);

  // Active Show State
  const [showTitle, setShowTitle] = useState("New Run of Show");
  const [startTime, setStartTime] = useState("09:00:00");
  const [customColumns, setCustomColumns] = useState(["Audio / Cues", "Video / Slides"]);
  const [rundown, setRundown] = useState([]);

  // Segment Repository State
  const [segmentLibrary, setSegmentLibrary] = useState([]);

  // Teleprompter States
  const [isPrompterPlaying, setIsPrompterPlaying] = useState(false);
  const [prompterSpeed, setPrompterSpeed] = useState(3);

  const prompterRef = useRef(null);
  const scrollTimerRef = useRef(null);

  // ==================== INITIALIZATION & AUTH ====================
  useEffect(() => {
    if (!auth || !db) {
      setAuthInitialized(true);
      setCloudSyncStatus("💾 Local Storage Mode (Firebase not initialized)");
      loadLocalShowsFallback();
      return;
    }

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth initialization error:", err);
        setCloudSyncStatus("⚠️ Auth Error - Local Mode");
      } finally {
        setAuthInitialized(true);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setCloudSyncStatus("🟢 Cloud Sync Active");
      }
    });
    return () => unsubscribe();
  }, []);

  // ==================== DATA SYNC (FIREBASE FIRESTORE) ====================
  useEffect(() => {
    if (!user || !db) return;

    // Listen to Segment Library
    const repoRef = doc(db, 'artifacts', appId, 'public', 'data', 'segment_library');
    const unsubRepo = onSnapshot(repoRef, (docSnap) => {
      if (docSnap.exists()) {
        setSegmentLibrary(docSnap.data().items || []);
      }
    }, (err) => console.error("Error loading segment library:", err));

    // Listen to Shows Index
    const showsIndexRef = doc(db, 'artifacts', appId, 'public', 'data', 'shows_index');
    const unsubIndex = onSnapshot(showsIndexRef, (docSnap) => {
      if (docSnap.exists()) {
        const list = docSnap.data().shows || [];
        setShowsList(list);
        if (list.length === 0 && currentView === "list") {
          createDefaultShow();
        } else if (list.length > 0 && !activeShowId) {
          setActiveShowId(list[0].id);
        }
      } else {
        createDefaultShow();
      }
      setCloudSyncStatus("🟢 Cloud Sync Active");
    }, (err) => {
      console.error("Error loading shows list:", err);
      setCloudSyncStatus("🔴 Sync Error (Check Firestore Rules)");
    });

    return () => {
      unsubRepo();
      unsubIndex();
    };
  }, [user]);

  // Listen to Active Show Document
  useEffect(() => {
    if (!user || !activeShowId || !db) return;

    const showDocRef = doc(db, 'artifacts', appId, 'public', 'data', `show_${activeShowId}`);
    const unsubShow = onSnapshot(showDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setShowTitle(data.showTitle || "Untitled Show");
        setStartTime(data.startTime || "09:00:00");
        setCustomColumns(data.customColumns || ["Audio / Cues", "Video / Slides"]);
        setRundown(data.rundown || []);
      }
    }, (err) => console.error("Error loading show document:", err));

    return () => unsubShow();
  }, [user, activeShowId]);

  const loadLocalShowsFallback = () => {
    try {
      const savedShows = localStorage.getItem("ros_shows_list");
      const savedLib = localStorage.getItem("ros_segment_lib");
      
      if (savedLib) {
        setSegmentLibrary(JSON.parse(savedLib));
      }

      if (savedShows) {
        const list = JSON.parse(savedShows);
        setShowsList(list);
        if (list.length > 0) {
          setActiveShowId(list[0].id);
          loadLocalShowDetails(list[0].id);
        } else {
          createDefaultShowLocal();
        }
      } else {
        createDefaultShowLocal();
      }
    } catch (e) {
      createDefaultShowLocal();
    }
  };

  const loadLocalShowDetails = (id) => {
    try {
      const showData = localStorage.getItem(`ros_show_${id}`);
      if (showData) {
        const parsed = JSON.parse(showData);
        setShowTitle(parsed.showTitle || "Untitled Show");
        setStartTime(parsed.startTime || "09:00:00");
        setCustomColumns(parsed.customColumns || ["Audio / Cues", "Video / Slides"]);
        setRundown(parsed.rundown || []);
      }
    } catch (e) {}
  };

  const saveShowData = async (newTitle = showTitle, newStart = startTime, newCols = customColumns, newRundown = rundown) => {
    if (!activeShowId) return;

    const showData = {
      id: activeShowId,
      showTitle: newTitle,
      startTime: newStart,
      customColumns: newCols,
      rundown: newRundown,
      updatedAt: new Date().toISOString()
    };

    if (user && db) {
      try {
        const showDocRef = doc(db, 'artifacts', appId, 'public', 'data', `show_${activeShowId}`);
        await setDoc(showDocRef, showData);

        const showsIndexRef = doc(db, 'artifacts', appId, 'public', 'data', 'shows_index');
        const indexSnap = await getDoc(showsIndexRef);
        let list = indexSnap.exists() ? (indexSnap.data().shows || []) : [];
        
        const existingIdx = list.findIndex(s => s.id === activeShowId);
        if (existingIdx >= 0) {
          list[existingIdx].title = newTitle;
          list[existingIdx].updatedAt = new Date().toISOString();
        } else {
          list.push({ id: activeShowId, title: newTitle, updatedAt: new Date().toISOString() });
        }
        await setDoc(showsIndexRef, { shows: list });
      } catch (err) {
        console.error("Failed to save to cloud:", err);
      }
    } else {
      try {
        localStorage.setItem(`ros_show_${activeShowId}`, JSON.stringify(showData));
        const updatedList = showsList.map(s => s.id === activeShowId ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s);
        setShowsList(updatedList);
        localStorage.setItem("ros_shows_list", JSON.stringify(updatedList));
      } catch (e) {}
    }
  };

  const createDefaultShowLocal = () => {
    const defaultId = "show_" + Date.now();
    const initialShow = {
      id: defaultId,
      showTitle: "Annual Keynote Conference 2026",
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides"],
      rundown: [
        { id: "block-1", type: "block", title: "BLOCK 1: INTRO & KEYNOTE", color: "#1e3a8a" },
        { 
          id: "seg-1", type: "segment", min: 1, sec: 30, 
          title: "Intro & Welcome", talent: "Host / MC", 
          script: "Welcome everyone to today's show! Please ensure your phones are on silent.", 
          customValues: ["Roll intro music", "Main presentation deck"], isUpper: false 
        },
        { 
          id: "cue-1", type: "cue", min: 0, sec: 15, 
          title: "Cue Video Roll", talent: "Gettysburg Video", color: "#FFD700", 
          customValues: ["Roll Opening Hype Reel", "Video Input 1"] 
        },
        { 
          id: "block-2", type: "block", title: "BLOCK 2: DEMO & Q&A", color: "#065f46" 
        },
        { 
          id: "seg-2", type: "segment", min: 5, sec: 0, 
          title: "Product Demo", talent: "Jane Smith", 
          script: "Switch input feed to live demo laptop. Walk through Features A, B, and C.", 
          customValues: ["HDMI 2 connected", "Stage timer active"], isUpper: false 
        }
      ]
    };

    setActiveShowId(defaultId);
    setShowsList([{ id: defaultId, title: initialShow.showTitle, updatedAt: new Date().toISOString() }]);
    setShowTitle(initialShow.showTitle);
    setStartTime(initialShow.startTime);
    setCustomColumns(initialShow.customColumns);
    setRundown(initialShow.rundown);
  };

  const createDefaultShow = async () => {
    const defaultId = "show_" + Date.now();
    const initialShow = {
      id: defaultId,
      showTitle: "Annual Keynote Conference 2026",
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides"],
      rundown: [
        { id: "block-1", type: "block", title: "BLOCK 1: INTRO & KEYNOTE", color: "#1e3a8a" },
        { 
          id: "seg-1", type: "segment", min: 1, sec: 30, 
          title: "Intro & Welcome", talent: "Host / MC", 
          script: "Welcome everyone to today's show! Please ensure your phones are on silent.", 
          customValues: ["Roll intro music", "Main presentation deck"], isUpper: false 
        },
        { 
          id: "cue-1", type: "cue", min: 0, sec: 15, 
          title: "Cue Video Roll", talent: "Gettysburg Video", color: "#FFD700", 
          customValues: ["Roll Opening Hype Reel", "Video Input 1"] 
        },
        { 
          id: "block-2", type: "block", title: "BLOCK 2: DEMO & Q&A", color: "#065f46" 
        },
        { 
          id: "seg-2", type: "segment", min: 5, sec: 0, 
          title: "Product Demo", talent: "Jane Smith", 
          script: "Switch input feed to live demo laptop. Walk through Features A, B, and C.", 
          customValues: ["HDMI 2 connected", "Stage timer active"], isUpper: false 
        }
      ]
    };

    if (user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', `show_${defaultId}`), initialShow);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shows_index'), {
          shows: [{ id: defaultId, title: initialShow.showTitle, updatedAt: new Date().toISOString() }]
        });
        setActiveShowId(defaultId);
      } catch (e) {
        console.error("Error creating default show:", e);
        createDefaultShowLocal();
      }
    } else {
      createDefaultShowLocal();
    }
  };

  const handleCreateNewShow = () => {
    const title = prompt("Enter new show title:", "New Run of Show");
    if (!title) return;

    const newId = "show_" + Date.now();
    const newShow = {
      id: newId,
      showTitle: title,
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides"],
      rundown: [
        { id: "block-1", type: "block", title: "BLOCK 1: MAIN SECTION", color: "#1e3a8a" },
        { id: "seg-1", type: "segment", min: 2, sec: 0, title: "Opening Segment", talent: "Host", script: "Type script here...", customValues: ["", ""], isUpper: false }
      ]
    };

    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'data', `show_${newId}`), newShow).then(() => {
        const updatedList = [...showsList, { id: newId, title: title, updatedAt: new Date().toISOString() }];
        setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shows_index'), { shows: updatedList });
        setActiveShowId(newId);
        setCurrentView("editor");
      });
    } else {
      const updatedList = [...showsList, { id: newId, title: title, updatedAt: new Date().toISOString() }];
      setShowsList(updatedList);
      setActiveShowId(newId);
      setShowTitle(title);
      setStartTime("09:00:00");
      setCustomColumns(["Audio / Cues", "Video / Slides"]);
      setRundown(newShow.rundown);
      setCurrentView("editor");
    }
  };

  const handleDeleteShow = (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this show?")) return;

    const updatedList = showsList.filter(s => s.id !== id);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shows_index'), { shows: updatedList }).then(() => {
        if (activeShowId === id) {
          setActiveShowId(updatedList.length > 0 ? updatedList[0].id : null);
        }
      });
    } else {
      setShowsList(updatedList);
      if (activeShowId === id) {
        setActiveShowId(updatedList.length > 0 ? updatedList[0].id : null);
      }
    }
  };

  const handleSelectShow = (id) => {
    setActiveShowId(id);
    if (!user || !db) {
      loadLocalShowDetails(id);
    }
    setCurrentView("editor");
  };

  const saveSegmentToLibrary = (item) => {
    if (item.type === "block") return;
    const newItem = {
      id: "lib_" + Date.now(),
      title: item.title || "Reusable Segment",
      talent: item.talent || "",
      min: item.min || 1,
      sec: item.sec || 0,
      script: item.script || "",
      customValues: item.customValues || []
    };

    const updatedLib = [...segmentLibrary, newItem];
    setSegmentLibrary(updatedLib);

    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'segment_library'), { items: updatedLib })
        .then(() => alert("Segment saved to your reusable repository library!"));
    } else {
      alert("Segment saved to your reusable repository library!");
    }
  };

  const insertSegmentFromLibrary = (libItem) => {
    const newItem = {
      id: "seg_" + Date.now(),
      type: "segment",
      min: libItem.min,
      sec: libItem.sec,
      title: libItem.title,
      talent: libItem.talent,
      script: libItem.script,
      customValues: [...(libItem.customValues || []), ...new Array(Math.max(0, customColumns.length - (libItem.customValues?.length || 0))).fill("")],
      isUpper: false
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const deleteFromLibrary = (libId) => {
    const updatedLib = segmentLibrary.filter(i => i.id !== libId);
    setSegmentLibrary(updatedLib);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'segment_library'), { items: updatedLib });
    }
  };

  const calculateTimes = () => {
    const parts = startTime.split(":");
    let currentSeconds = (parseInt(parts[0]) || 0) * 3600 + 
                         (parseInt(parts[1]) || 0) * 60 + 
                         (parseInt(parts[2]) || 0);

    return rundown.map(item => {
      if (item.type === "block") {
        return { ...item, calculatedTime: "" };
      }

      const dateObj = new Date();
      dateObj.setHours(0, 0, 0, 0);
      dateObj.setSeconds(currentSeconds);
      const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const durationSecs = (parseInt(item.min) || 0) * 60 + (parseInt(item.sec) || 0);
      currentSeconds += durationSecs;

      return { ...item, calculatedTime: timeString };
    });
  };

  const timedRundown = calculateTimes();

  const addSegmentRow = () => {
    const newItem = {
      id: "seg-" + Date.now(),
      type: "segment",
      min: 1,
      sec: 0,
      title: "New Segment",
      talent: "Talent",
      script: "Type script or notes here...",
      customValues: new Array(customColumns.length).fill(""),
      isUpper: false
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const addCueRow = () => {
    const newItem = {
      id: "cue-" + Date.now(),
      type: "cue",
      min: 0,
      sec: 15,
      title: "New Cue",
      talent: "Trigger / Deck",
      color: "#FFD700",
      customValues: new Array(customColumns.length).fill("")
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const addBlockHeaderRow = () => {
    const newItem = {
      id: "block-" + Date.now(),
      type: "block",
      title: "NEW BLOCK SECTION",
      color: "#3b82f6"
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const deleteRow = (index) => {
    const updated = [...rundown];
    updated.splice(index, 1);
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const moveRow = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= rundown.length) return;
    const updated = [...rundown];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const updateItemField = (index, field, value) => {
    const updated = [...rundown];
    updated[index][field] = value;
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const updateCustomValue = (itemIndex, colIndex, value) => {
    const updated = [...rundown];
    if (!updated[itemIndex].customValues) {
      updated[itemIndex].customValues = new Array(customColumns.length).fill("");
    }
    updated[itemIndex].customValues[colIndex] = value;
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const handleAddColumn = () => {
    const colName = prompt("Enter Column Header Name (e.g. Audio, Lighting, Slides):");
    if (!colName) return;
    const newCols = [...customColumns, colName];
    setCustomColumns(newCols);
    
    const newRundown = rundown.map(item => ({
      ...item,
      customValues: [...(item.customValues || new Array(customColumns.length).fill("")), ""]
    }));
    setRundown(newRundown);
    saveShowData(showTitle, startTime, newCols, newRundown);
  };

  const handleRemoveColumn = (colIndex) => {
    const newCols = customColumns.filter((_, idx) => idx !== colIndex);
    setCustomColumns(newCols);
    
    const newRundown = rundown.map(item => {
      const cv = [...(item.customValues || [])];
      cv.splice(colIndex, 1);
      return { ...item, customValues: cv };
    });
    setRundown(newRundown);
    saveShowData(showTitle, startTime, newCols, newRundown);
  };

  useEffect(() => {
    if (isPrompterPlaying) {
      scrollTimerRef.current = setInterval(() => {
        if (prompterRef.current) {
          prompterRef.current.scrollTop += prompterSpeed;
        }
      }, 50);
    } else {
      clearInterval(scrollTimerRef.current);
    }
    return () => clearInterval(scrollTimerRef.current);
  }, [isPrompterPlaying, prompterSpeed]);

  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center font-sans">
        <div className="text-center animate-pulse">
          <h2 className="text-xl font-bold">Connecting Run of Show Cloud...</h2>
          <p className="text-sm text-slate-400 mt-2">Authenticating with Firebase</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      
      {/* Top Application Global Navigation Header */}
      <div className="bg-slate-900 text-white px-6 py-4 rounded-xl mb-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎬</span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Run of Show Cloud Studio</h1>
            <p className="text-xs text-emerald-400 font-semibold">{cloudSyncStatus}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => setCurrentView("list")} 
            className={`px-3 py-1.5 rounded text-sm font-bold transition ${currentView === "list" ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            📋 All Shows ({showsList.length})
          </button>
          {activeShowId && (
            <button 
              onClick={() => setCurrentView("editor")} 
              className={`px-3 py-1.5 rounded text-sm font-bold transition ${currentView === "editor" ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              ✏️ Active Show Editor
            </button>
          )}
          <button 
            onClick={() => setCurrentView("repository")} 
            className={`px-3 py-1.5 rounded text-sm font-bold transition ${currentView === "repository" ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            📚 Segment Repository ({segmentLibrary.length})
          </button>
          {activeShowId && (
            <button 
              onClick={() => setCurrentView("teleprompter")} 
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-sm font-bold transition flex items-center gap-1 shadow"
            >
              📺 Launch Teleprompter
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: SHOWS LIST MANAGER */}
      {currentView === "list" && (
        <div className="max-w-5xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold">Your Saved Shows</h2>
              <p className="text-sm text-slate-500">Create and manage multiple production rundowns saved instantly in the cloud.</p>
            </div>
            <button 
              onClick={handleCreateNewShow}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow transition flex items-center gap-2"
            >
              + Create New Show
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {showsList.map((show) => (
              <div 
                key={show.id} 
                onClick={() => handleSelectShow(show.id)}
                className={`bg-white p-5 rounded-xl border transition shadow-sm hover:shadow-md cursor-pointer flex flex-col justify-between ${activeShowId === show.id ? 'border-blue-600 ring-2 ring-blue-600/20' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h3 className="font-bold text-lg text-slate-900 line-clamp-2">{show.title || "Untitled Show"}</h3>
                    <button 
                      onClick={(e) => handleDeleteShow(show.id, e)}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition text-xs font-bold"
                      title="Delete Show"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">Last modified: {new Date(show.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <span className="text-xs font-bold text-blue-600">Open Editor →</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleSelectShow(show.id); setCurrentView("teleprompter"); }}
                    className="bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs px-2.5 py-1 rounded font-bold transition"
                  >
                    📺 Teleprompter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 2: SEGMENT REPOSITORY LIBRARY */}
      {currentView === "repository" && (
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h2 className="text-2xl font-bold">Reusable Segment Repository</h2>
            <p className="text-sm text-slate-500">Save frequently used segments or cues from any show here and quickly inject them into new rundowns across your devices.</p>
          </div>

          {segmentLibrary.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
              <p className="text-lg font-semibold mb-1">No saved segments in your library yet.</p>
              <p className="text-xs">While editing any show rundown, click the "💾 Save to Library" button on any segment row.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {segmentLibrary.map((libItem) => (
                <div key={libItem.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <h4 className="font-bold text-base text-slate-900">{libItem.title}</h4>
                      <button onClick={() => deleteFromLibrary(libItem.id)} className="text-rose-500 hover:text-rose-700 text-xs font-bold">Delete</button>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-500 mb-3">
                      <span>⏱️ {libItem.min}m {libItem.sec}s</span>
                      {libItem.talent && <span>🎙️ {libItem.talent}</span>}
                    </div>
                    <div 
                      dangerouslySetInnerHTML={{ __html: libItem.script }} 
                      className="text-xs text-slate-600 bg-slate-50 p-3 rounded border border-slate-100 max-h-24 overflow-y-auto mb-4"
                    />
                  </div>
                  {activeShowId && (
                    <button 
                      onClick={() => { insertSegmentFromLibrary(libItem); alert(`Added "${libItem.title}" to active show rundown!`); }}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 px-3 rounded transition w-full shadow-sm"
                    >
                      + Insert into Active Show
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: TELEPROMPTER FULLSCREEN OVERLAY */}
      {currentView === "teleprompter" && (
        <div className="fixed inset-0 bg-black z-50 p-6 flex flex-col text-white">
          <div className="absolute top-4 right-6 bg-slate-900/95 border border-slate-700 p-3 rounded-lg flex items-center gap-4 shadow-2xl z-50">
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-600 font-bold">🟢 Live Cloud Teleprompter</span>
            <button 
              onClick={() => setIsPrompterPlaying(!isPrompterPlaying)}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded text-sm font-bold shadow"
            >
              {isPrompterPlaying ? "⏸ Pause Scroll" : "▶ Play Scroll"}
            </button>
            <label className="text-xs flex items-center gap-2">
              Speed:
              <input 
                type="range" 
                min="1" 
                max="10" 
                value={prompterSpeed} 
                onChange={(e) => setPrompterSpeed(parseInt(e.target.value))}
                className="cursor-pointer"
              />
            </label>
            <button 
              onClick={() => setCurrentView("editor")}
              className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded text-xs font-bold"
            >
              Close Prompter
            </button>
          </div>

          <div ref={prompterRef} className="flex-1 overflow-y-auto max-w-4xl mx-auto my-20 px-4 text-2xl md:text-3xl leading-relaxed">
            <h1 className="text-3xl font-bold text-sky-400 mb-8 pb-4 border-b border-slate-800">{showTitle}</h1>
            {timedRundown.map((item, idx) => {
              if (item.type === "block") {
                return (
                  <div 
                    key={idx} 
                    style={{ backgroundColor: item.color }} 
                    className="p-4 my-8 font-bold text-xl uppercase rounded shadow-lg text-white"
                  >
                    {item.title || "SECTION BREAK"}
                  </div>
                );
              }
              if (item.type === "cue") {
                return (
                  <div 
                    key={idx} 
                    style={{ backgroundColor: item.color, color: item.color === "#B22222" ? "#fff" : "#0f172a" }} 
                    className="p-4 my-6 font-bold rounded-lg shadow text-lg"
                  >
                    [CUE {item.calculatedTime}] {item.title || 'Cue Trigger'} {item.talent ? `| Talent: ${item.talent}` : ''}
                  </div>
                );
              }
              if (item.type === "segment" && item.script && item.script.replace(/<[^>]*>/g, '').trim() !== "") {
                return (
                  <div key={idx} className="mb-10 pb-6 border-b border-slate-800">
                    <div className="text-sky-400 font-bold text-lg mb-1">[{item.calculatedTime}] {item.title || 'Untitled Segment'}</div>
                    {item.talent && <div className="text-amber-400 text-base font-semibold mb-3">🎙️ Talent: {item.talent}</div>}
                    <div 
                      style={{ textTransform: item.isUpper ? 'uppercase' : 'none' }}
                      dangerouslySetInnerHTML={{ __html: item.script }} 
                    />
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      )}

      {/* VIEW 4: ACTIVE SHOW EDITOR */}
      {currentView === "editor" && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <input 
              type="text" 
              value={showTitle} 
              onChange={(e) => { setShowTitle(e.target.value); saveShowData(e.target.value, startTime, customColumns, rundown); }}
              className="text-2xl md:text-3xl font-bold bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white rounded-lg px-2 py-1 flex-1 transition"
              placeholder="Enter Show Name..."
            />
          </div>

          <div className="sticky top-0 z-40 bg-slate-50/95 backdrop-blur py-3 mb-6 flex flex-wrap gap-3 items-center border-b border-slate-200">
            <label className="font-semibold flex items-center gap-2 text-sm">
              Start Time: 
              <input 
                type="time" 
                step="1" 
                value={startTime} 
                onChange={(e) => { setStartTime(e.target.value); saveShowData(showTitle, e.target.value, customColumns, rundown); }}
                className="px-2 py-1 border border-slate-300 rounded text-sm bg-white"
              />
            </label>
            
            <button onClick={addSegmentRow} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">+ Add Segment</button>
            <button onClick={addCueRow} className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">+ Add Cue Line</button>
            <button onClick={addBlockHeaderRow} className="bg-slate-600 hover:bg-slate-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">+ Add Block Break</button>
            <button onClick={handleAddColumn} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">+ Add Custom Column</button>
            
            <button onClick={() => setCurrentView("teleprompter")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm flex items-center gap-1">
              📺 Launch Teleprompter
            </button>
            <button onClick={() => window.print()} className="bg-slate-600 hover:bg-slate-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">📄 Print / PDF</button>
          </div>

          <div className="overflow-x-auto shadow-lg rounded-lg border border-slate-200 bg-white">
            <table className="w-full border-collapse min-w-[950px]">
              <thead>
                <tr className="bg-slate-900 text-white text-left text-xs uppercase tracking-wider">
                  <th className="p-3 w-[100px]">Start Time</th>
                  <th className="p-3 w-[110px]">Duration</th>
                  <th className="p-3 w-[160px]">Segment / Title</th>
                  <th className="p-3 w-[120px]">Talent</th>
                  <th className="p-3 w-[320px]">Script / Cues</th>
                  {customColumns.map((col, idx) => (
                    <th key={idx} className="p-3 w-[140px]">
                      <div className="flex items-center justify-between gap-2">
                        <span>{col}</span>
                        <button 
                          onClick={() => handleRemoveColumn(idx)} 
                          className="bg-rose-500 hover:bg-rose-700 text-white text-[10px] px-1.5 py-0.5 rounded transition"
                          title="Delete Column"
                        >
                          ✕
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="p-3 w-[140px] text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {timedRundown.map((item, index) => {
                  if (item.type === "block") {
                    const totalCols = 6 + customColumns.length;
                    return (
                      <tr key={item.id} style={{ backgroundColor: item.color }} className="transition-colors">
                        <td colSpan={totalCols} className="p-3">
                          <div className="flex items-center gap-3">
                            <input 
                              type="color" 
                              value={item.color} 
                              onChange={(e) => updateItemField(index, 'color', e.target.value)}
                              className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                            />
                            <input 
                              type="text" 
                              value={item.title} 
                              onChange={(e) => updateItemField(index, 'title', e.target.value)}
                              className="font-bold text-base text-white bg-white/20 border border-white/30 rounded px-2 py-1 w-full focus:outline-none focus:bg-white/30"
                            />
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(index, -1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▼</button>
                            <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs px-2 py-1 rounded">Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  if (item.type === "cue") {
                    const isFireBrick = item.color === "#B22222";
                    return (
                      <tr key={item.id} style={{ backgroundColor: item.color, color: isFireBrick ? '#fff' : '#0f172a' }} className="transition-colors">
                        <td className="p-3 font-mono font-bold text-sm">{item.calculatedTime}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <input 
                              type="number" 
                              value={item.min} 
                              min="0" 
                              onChange={(e) => updateItemField(index, 'min', e.target.value)}
                              className="w-12 text-center p-1 border rounded bg-white text-slate-900 text-sm"
                            />m
                            <input 
                              type="number" 
                              value={item.sec} 
                              min="0" 
                              max="59" 
                              onChange={(e) => updateItemField(index, 'sec', e.target.value)}
                              className="w-12 text-center p-1 border rounded bg-white text-slate-900 text-sm"
                            />s
                          </div>
                        </td>
                        <td className="p-3">
                          <input 
                            type="text" 
                            value={item.title} 
                            onChange={(e) => updateItemField(index, 'title', e.target.value)}
                            className="w-full p-1 border border-slate-300 rounded bg-white text-slate-900 text-sm"
                            placeholder="Cue Title..."
                          />
                        </td>
                        <td className="p-3">
                          <input 
                            type="text" 
                            value={item.talent} 
                            onChange={(e) => updateItemField(index, 'talent', e.target.value)}
                            className="w-full p-1 border border-slate-300 rounded bg-white text-slate-900 text-sm"
                            placeholder="Talent..."
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs uppercase tracking-wide">Cue Color:</span>
                            <select 
                              value={item.color} 
                              onChange={(e) => updateItemField(index, 'color', e.target.value)}
                              className="p-1 border rounded bg-white text-slate-900 text-xs"
                            >
                              <option value="#FFD700">Gold</option>
                              <option value="#90EE90">LightGreen</option>
                              <option value="#6495ED">CornflowerBlue</option>
                              <option value="#B22222">FireBrick</option>
                            </select>
                          </div>
                        </td>
                        {customColumns.map((_, colIdx) => (
                          <td key={colIdx} className="p-3">
                            <input 
                              type="text" 
                              value={item.customValues?.[colIdx] || ""} 
                              onChange={(e) => updateCustomValue(index, colIdx, e.target.value)}
                              className="w-full p-1 border border-slate-300 rounded bg-white text-slate-900 text-sm"
                              placeholder="Notes..."
                            />
                          </td>
                        ))}
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(index, -1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▼</button>
                            <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs px-2 py-1 rounded">Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 font-mono font-bold text-sm text-slate-700">{item.calculatedTime}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <input 
                            type="number" 
                            value={item.min} 
                            min="0" 
                            onChange={(e) => updateItemField(index, 'min', e.target.value)}
                            className="w-12 text-center p-1 border border-slate-300 rounded text-sm"
                          />m
                          <input 
                            type="number" 
                            value={item.sec} 
                            min="0" 
                            max="59" 
                            onChange={(e) => updateItemField(index, 'sec', e.target.value)}
                            className="w-12 text-center p-1 border rounded text-sm"
                          />s
                        </div>
                      </td>
                      <td className="p-3">
                        <input 
                          type="text" 
                          value={item.title} 
                          onChange={(e) => updateItemField(index, 'title', e.target.value)}
                          className="w-full p-1 border border-slate-300 rounded text-sm"
                          placeholder="Segment Name"
                        />
                      </td>
                      <td className="p-3">
                        <input 
                          type="text" 
                          value={item.talent} 
                          onChange={(e) => updateItemField(index, 'talent', e.target.value)}
                          className="w-full p-1 border border-slate-300 rounded text-sm"
                          placeholder="Talent Name"
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <div className="flex gap-1">
                            <button onClick={() => document.execCommand('bold')} className="bg-slate-200 hover:bg-slate-300 px-1.5 py-0.5 text-xs rounded font-bold">B</button>
                            <button onClick={() => document.execCommand('italic')} className="bg-slate-200 hover:bg-slate-300 px-1.5 py-0.5 text-xs rounded italic">I</button>
                            <button onClick={() => document.execCommand('underline')} className="bg-slate-200 hover:bg-slate-300 px-1.5 py-0.5 text-xs rounded underline">U</button>
                            <button 
                              onClick={() => updateItemField(index, 'isUpper', !item.isUpper)} 
                              className={`px-1.5 py-0.5 text-xs rounded font-semibold ${item.isUpper ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                            >
                              ALL CAPS
                            </button>
                          </div>
                          <button 
                            onClick={() => saveSegmentToLibrary(item)}
                            className="bg-purple-100 hover:bg-purple-200 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded transition"
                            title="Save segment into reusable repository library"
                          >
                            💾 Save to Library
                          </button>
                        </div>
                        <div 
                          contentEditable={true} 
                          suppressContentEditableWarning={true}
                          onBlur={(e) => updateItemField(index, 'script', e.target.innerHTML)}
                          dangerouslySetInnerHTML={{ __html: item.script }}
                          style={{ textTransform: item.isUpper ? 'uppercase' : 'none' }}
                          className="min-h-[50px] p-2 border border-slate-300 rounded bg-white text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 overflow-y-auto"
                        />
                      </td>
                      {customColumns.map((_, colIdx) => (
                        <td key={colIdx} className="p-3">
                          <input 
                            type="text" 
                            value={item.customValues?.[colIdx] || ""} 
                            onChange={(e) => updateCustomValue(index, colIdx, e.target.value)}
                            className="w-full p-1 border border-slate-300 rounded text-sm"
                            placeholder="Notes..."
                          />
                        </td>
                      ))}
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => moveRow(index, -1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▲</button>
                          <button onClick={() => moveRow(index, 1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▼</button>
                          <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs px-2 py-1 rounded">Del</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headphones, Mic, X } from 'lucide-react';
import { recordAndTranscribe, speakWithBrowser, speakWithGnani } from './voice.js';

const destinations = [
  { id: 'toilet0', terms: ['washroom', 'toilet', 'restroom', 'bathroom', 'शौचालय', 'बाथरूम', 'கழிப்பறை', 'শৌচাগার'] },
  { id: 'pharmacy', terms: ['pharmacy', 'medicine shop', 'दवा', 'फार्मेसी', 'மருந்தகம்', 'ওষুধের দোকান', 'ফার্মেসি'] },
  { id: 'emergency', terms: ['emergency', 'casualty', 'आपातकाल', 'इमरजेंसी', 'அவசரம்', 'জরুরি বিভাগ'] },
  { id: 'registration', terms: ['registration', 'register counter', 'पंजीकरण', 'ரजिस்ட்ரेशन', 'பதிவு', 'নিবন্ধন'] },
  { id: 'help', terms: ['help desk', 'helpdesk', 'सहायता कक्ष', 'मदद कक्ष', 'உதவி மையம்', 'সহায়তা ডেস্ক'] },
  { id: 'lab', terms: ['laboratory', 'lab', 'प्रयोगशाला', 'जांच घर', 'ஆய்வகம்', 'পরীক্ষাগার'] },
  { id: 'xray', terms: ['x-ray', 'xray', 'एक्स रे', 'எக்ஸ்ரே', 'এক্স-রে'] },
  { id: 'waitingA', terms: ['waiting room', 'waiting hall', 'प्रतीक्षा कक्ष', 'காத்திருப்பு அறை', 'অপেক্ষার ঘর'] },
  { id: 'wheelchair', terms: ['wheelchair', 'व्हीलचेयर', 'சக்கர நாற்காலி', 'হুইলচেয়ার'] },
  ...Array.from({ length: 8 }, (_, index) => ({ id: `room${index + 1}`, terms: [`opd ${index + 1}`, `room ${index + 1}`, `ward ${index + 1}`] })),
];

const textFor = (language, key) => {
  const strings = {
    en: {
      intro: 'Hi, I can help you use the hospital app, find a listed place, check registration and queue steps, or explain emergency help. What would you like?',
      direction: (place) => `I’ll open directions to ${place}. Choose your starting point and follow the guide.`,
      register: 'I’ll open patient registration. Enter your details and choose a department to get an OPD slip.',
      queue: 'To check your place in line, enter your token on the “I have my slip” page.',
      opd: 'OPD means outpatient department: a clinic visit without staying overnight.',
      emergency: 'For an emergency, go to the Emergency department or tell nearby staff. Call 112 or 108 for an ambulance.',
      hours: 'The demo lists OPD hours as 9 AM to 2 PM. Please confirm hours with hospital staff.',
      token: 'A token is your place in the queue. Use it on the “I have my slip” page to check your queue.',
      settings: 'Open Settings to change the app language, voice language, text size, and accessibility options.',
      fallback: 'I can help with registration, tokens and queues, directions to listed places, app settings, or emergency help. Try asking about one of those.',
      listening: 'Listening for up to 7 seconds…',
      transcribed: (value) => `I heard: “${value}”`,
      error: (value) => `I couldn’t hear that: ${value}`,
      button: 'Talk to hospital assistant', title: 'Hospital voice assistant', placeholder: 'Tap the microphone and speak',
    },
    hi: {
      intro: 'नमस्ते, मैं अस्पताल ऐप, पंजीकरण, टोकन, कतार, अस्पताल में जगह ढूँढ़ने और आपातकालीन सहायता में मदद कर सकता हूँ। आपको क्या जानना है?',
      direction: (place) => `मैं ${place} के रास्ते खोल रहा हूँ। शुरुआती जगह चुनें और मार्गदर्शक का अनुसरण करें।`,
      register: 'मैं पंजीकरण खोल रहा हूँ। ओपीडी पर्ची पाने के लिए विवरण भरें और विभाग चुनें।',
      queue: 'कतार में अपनी जगह देखने के लिए “मेरी पर्ची” पेज पर टोकन डालें।',
      opd: 'ओपीडी का अर्थ बाह्य रोगी विभाग है। इसमें रातभर अस्पताल में भर्ती नहीं होना पड़ता।',
      emergency: 'आपातकाल में आपातकालीन विभाग जाएँ या पास के कर्मचारी को बताएँ। एम्बुलेंस के लिए 112 या 108 पर कॉल करें।',
      hours: 'डेमो में ओपीडी का समय सुबह 9 से दोपहर 2 बजे तक है। अस्पताल के कर्मचारियों से समय की पुष्टि करें।',
      token: 'टोकन कतार में आपकी जगह बताता है। कतार देखने के लिए इसे “मेरी पर्ची” पेज पर डालें।',
      settings: 'ऐप की भाषा, आवाज़, अक्षरों का आकार और पहुँच विकल्प बदलने के लिए सेटिंग्स खोलें।',
      fallback: 'मैं पंजीकरण, टोकन, कतार, जगह ढूँढ़ने, ऐप सेटिंग्स या आपातकालीन सहायता में मदद कर सकता हूँ। इनमें से कुछ पूछें।',
      listening: 'सुन रहा हूँ… 7 सेकंड तक बोलें।', transcribed: (value) => `मैंने सुना: “${value}”`,
      error: (value) => `आवाज़ समझ नहीं आई: ${value}`, button: 'अस्पताल सहायक से बात करें', title: 'अस्पताल आवाज़ सहायक', placeholder: 'माइक दबाकर बोलें',
    },
    ta: {
      intro: 'வணக்கம், மருத்துவமனை செயலி, பதிவு, டோக்கன், வரிசை, இடம் கண்டறிதல் மற்றும் அவசர உதவியில் நான் உதவுவேன். என்ன தெரிந்துகொள்ள வேண்டும்?',
      direction: (place) => `${place}-க்கான வழியைத் திறக்கிறேன். தொடக்க இடத்தைத் தேர்ந்தெடுத்து வழிகாட்டியைப் பின்பற்றுங்கள்.`,
      register: 'பதிவுப் பக்கத்தைத் திறக்கிறேன். OPD சீட்டைப் பெற விவரங்களை நிரப்பி பிரிவைத் தேர்ந்தெடுக்கவும்.',
      queue: 'வரிசையில் உங்கள் இடத்தைப் பார்க்க “என் சீட்டு” பக்கத்தில் டோக்கனை உள்ளிடுங்கள்.',
      opd: 'OPD என்பது வெளிநோயாளர் பிரிவு. இரவு தங்காமல் மருத்துவமனைக்கு வரும் சிகிச்சை இது.',
      emergency: 'அவசரநிலையில் அவசரப் பிரிவுக்குச் செல்லுங்கள் அல்லது அருகிலுள்ள பணியாளரிடம் சொல்லுங்கள். ஆம்புலன்ஸுக்கு 112 அல்லது 108 அழைக்கவும்.',
      hours: 'இந்த மாதிரியில் OPD நேரம் காலை 9 மணி முதல் மதியம் 2 மணி வரை. மருத்துவமனை பணியாளரிடம் உறுதிப்படுத்தவும்.',
      token: 'டோக்கன் வரிசையில் உங்கள் இடத்தைக் காட்டும். வரிசையைப் பார்க்க “என் சீட்டு” பக்கத்தில் அதை உள்ளிடுங்கள்.',
      settings: 'மொழி, குரல் மொழி, எழுத்து அளவு மற்றும் அணுகல் விருப்பங்களை மாற்ற அமைப்புகளைத் திறக்கவும்.',
      fallback: 'பதிவு, டோக்கன், வரிசை, இடம் கண்டறிதல், அமைப்புகள் அல்லது அவசர உதவியில் உதவ முடியும். அவற்றில் ஒன்றைக் கேளுங்கள்.',
      listening: 'கேட்கிறேன்… 7 விநாடிகள் வரை பேசுங்கள்.', transcribed: (value) => `நான் கேட்டது: “${value}”`,
      error: (value) => `கேட்க முடியவில்லை: ${value}`, button: 'மருத்துவமனை உதவியாளரிடம் பேசுங்கள்', title: 'மருத்துவமனை குரல் உதவியாளர்', placeholder: 'மைக்ரோஃபோனை அழுத்திப் பேசுங்கள்',
    },
    bn: {
      intro: 'নমস্কার, হাসপাতাল অ্যাপ, নিবন্ধন, টোকেন, সারি, হাসপাতালের জায়গা খোঁজা এবং জরুরি সাহায্যে আমি সহায়তা করতে পারি। কী জানতে চান?',
      direction: (place) => `${place}-এর দিকনির্দেশ খুলছি। শুরুর জায়গা বেছে নিয়ে গাইড অনুসরণ করুন।`,
      register: 'নিবন্ধন খুলছি। OPD স্লিপ পেতে তথ্য পূরণ করে বিভাগ বেছে নিন।',
      queue: 'সারিতে আপনার অবস্থান দেখতে “আমার স্লিপ” পাতায় টোকেন লিখুন।',
      opd: 'OPD অর্থ বহির্বিভাগ। এখানে রাতভর হাসপাতালে ভর্তি থাকতে হয় না।',
      emergency: 'জরুরি অবস্থায় জরুরি বিভাগে যান বা কাছের কর্মীকে জানান। অ্যাম্বুলেন্সের জন্য 112 বা 108-এ কল করুন।',
      hours: 'ডেমোতে OPD সময় সকাল 9টা থেকে দুপুর 2টা। হাসপাতালের কর্মীদের কাছে সময় নিশ্চিত করুন।',
      token: 'টোকেন সারিতে আপনার অবস্থান জানায়। সারি দেখতে “আমার স্লিপ” পাতায় এটি লিখুন।',
      settings: 'অ্যাপের ভাষা, কণ্ঠের ভাষা, লেখার আকার ও অ্যাক্সেসিবিলিটি বদলাতে সেটিংস খুলুন।',
      fallback: 'নিবন্ধন, টোকেন, সারি, জায়গা খোঁজা, সেটিংস বা জরুরি সাহায্য নিয়ে প্রশ্ন করুন।',
      listening: 'শুনছি… 7 সেকেন্ড পর্যন্ত বলুন।', transcribed: (value) => `আমি শুনেছি: “${value}”`,
      error: (value) => `শুনতে পারিনি: ${value}`, button: 'হাসপাতাল সহায়কের সঙ্গে কথা বলুন', title: 'হাসপাতাল ভয়েস সহায়ক', placeholder: 'মাইক্রোফোন টিপে বলুন',
    },
  };
  return strings[language] || strings.en;
};

export default function AssistantWidget({ language = 'en', voiceLanguage = language }) {
  const navigate = useNavigate();
  const copy = textFor(language, 'strings');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);

  const answer = async (spoken) => {
    const lower = spoken.toLocaleLowerCase();
    const normalized = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let reply = copy.fallback;
    const destination = destinations.find((place) => place.terms.some((term) => normalized.includes(term.toLocaleLowerCase())));
    if (destination) {
      const place = destination.id.startsWith('room') ? `OPD ${destination.id.slice(4)}` : destination.terms[0];
      reply = copy.direction(place);
      navigate(`/find?place=${destination.id}`);
    } else if (['register', 'registration', 'पंजीकरण', 'பதிவு', 'নিবন্ধন'].some((word) => normalized.includes(word))) {
      reply = copy.register; navigate('/register');
    } else if (['queue', 'token', 'कतार', 'टोकन', 'வரிசை', 'டோக்கன்', 'সারি', 'টোকেন'].some((word) => normalized.includes(word))) {
      reply = copy.queue; navigate('/have-slip');
    } else if (['opd meaning', 'what is opd', 'opd kya', 'ओपीडी क्या', 'opd என்றால்', 'opd মানে'].some((word) => normalized.includes(word))) reply = copy.opd;
    else if (['emergency', 'ambulance', '112', '108', 'आपातकाल', 'एम्बुलेंस', 'அவசரம்', 'ஆம்புலன்ஸ்', 'জরুরি', 'অ্যাম্বুলেন্স'].some((word) => normalized.includes(word))) {
      reply = copy.emergency; navigate('/emergency');
    } else if (['hours', 'timing', 'समय', 'நேரம்', 'সময়'].some((word) => normalized.includes(word))) reply = copy.hours;
    else if (['settings', 'language', 'सेटिंग', 'भाषा', 'அமைப்பு', 'மொழி', 'সেটিংস', 'ভাষা'].some((word) => normalized.includes(word))) {
      reply = copy.settings; navigate('/settings');
    }
    setMessages((items) => [...items, { from: 'assistant', text: reply }].slice(-6));
    try { await speakWithGnani(reply, voiceLanguage); } catch { speakWithBrowser(reply, voiceLanguage); }
  };

  const listen = async () => {
    setOpen(true); setBusy(true);
    setMessages((items) => [...items, { from: 'assistant', text: copy.listening }].slice(-6));
    try {
      const heard = await recordAndTranscribe(voiceLanguage);
      setMessages((items) => [...items.slice(0, -1), { from: 'you', text: heard }].slice(-6));
      await answer(heard);
    } catch (error) {
      const message = copy.error(error instanceof Error ? error.message : 'Please try again.');
      setMessages((items) => [...items.slice(0, -1), { from: 'assistant', text: message }].slice(-6));
      try { await speakWithGnani(message, voiceLanguage); } catch { speakWithBrowser(message, voiceLanguage); }
    } finally { setBusy(false); }
  };

  return <div className="global-assistant">
    {open && <section className="global-assistant-panel" aria-label={copy.title}>
      <header className="global-assistant-head"><div><Headphones size={19}/><b>{copy.title}</b></div><button onClick={() => setOpen(false)} aria-label="Close assistant"><X size={19}/></button></header>
      <div className="global-assistant-messages" aria-live="polite">
        {messages.length === 0 && <p className="global-assistant-intro">{copy.intro}</p>}
        {messages.map((message, index) => <p key={`${index}-${message.from}`} className={`global-assistant-message ${message.from}`}>{message.text}</p>)}
      </div>
      <button className="global-assistant-listen" onClick={listen} disabled={busy}><Mic size={19}/>{busy ? copy.listening : copy.placeholder}</button>
      <small>Gnani voice · Say a listed place, or ask about this app</small>
    </section>}
    <button className="global-assistant-fab" onClick={() => setOpen((value) => !value)} aria-label={copy.button} aria-expanded={open}><Mic size={25}/></button>
  </div>;
}

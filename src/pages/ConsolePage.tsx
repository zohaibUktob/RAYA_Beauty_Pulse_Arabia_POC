import { useEffect, useRef, useCallback, useState } from 'react';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import {
	ai_travel_instructions,
	ai_ordering_instructions,
	ai_sales_instructions
} from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import './ConsolePage.scss';
import Lottie from 'react-lottie-player/dist/LottiePlayerLight';
import sphereAnimation from '../assets/animations/SphereAnimation.json';
import sphereImg from '../assets/sphere.png';
import AutonomousBg from '../assets/autonomous-bg.svg';

import { Description, Field, Label, Select } from '@headlessui/react';
import clsx from 'clsx';
/**
 * Type for result from get_weather() function call
 */
interface Coordinates {
	lat: number;
	lng: number;
	location?: string;
	temperature?: {
		value: number;
		units: string;
	};
	wind_speed?: {
		value: number;
		units: string;
	};
}

/**
 * Type for all event logs
 */
interface RealtimeEvent {
	time: string;
	source: 'client' | 'server';
	count?: number;
	event: { [key: string]: any };
}

export function ConsolePage() {

	const wavRecorderRef = useRef<WavRecorder>(
		new WavRecorder({ sampleRate: 24000 })
	);
	const wavStreamPlayerRef = useRef<WavStreamPlayer>(
		new WavStreamPlayer({ sampleRate: 24000 })
	);
	const clientRef = useRef<RealtimeClient>(
		new RealtimeClient({ apiKey: process.env.REACT_APP_OPENAI_API_KEY, dangerouslyAllowAPIKeyInBrowser: true })
	);

	/**
	 * References for
	 * - Rendering audio visualization (canvas)
	 * - Autoscrolling event logs
	 * - Timing delta for event log displays
	 */
	const clientCanvasRef = useRef<HTMLCanvasElement>(null);
	const serverCanvasRef = useRef<HTMLCanvasElement>(null);
	const eventsScrollHeightRef = useRef(0);
	const eventsScrollRef = useRef<HTMLDivElement>(null);
	const startTimeRef = useRef<string>(new Date().toISOString());

	/**
	 * All of our variables for displaying application state
	 * - items are all conversation items (dialog)
	 * - realtimeEvents are event logs, which can be expanded
	 * - memoryKv is for set_memory() function
	 * - coords, marker are for get_weather() function
	 */
	const [items, setItems] = useState<ItemType[]>([]);
	const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
	const [expandedEvents, setExpandedEvents] = useState<{
		[key: string]: boolean;
	}>({});
	const [isConnected, setIsConnected] = useState(false);
	const [isHovering, setIsHovering] = useState(false);
	const [isConnecting, setIsConnecting] = useState(false);
	const [canPushToTalk, setCanPushToTalk] = useState(true);
	const [isRecording, setIsRecording] = useState(false);
	const [memoryKv, setMemoryKv] = useState<{ [key: string]: any }>({});
	const [coords, setCoords] = useState<Coordinates | null>({
		lat: 37.775593,
		lng: -122.418137,
	});
	const [marker, setMarker] = useState<Coordinates | null>(null);
	const [role, setRole] = useState<string>('Travel');
	const [travelLanguage, setTravelLanguage] = useState<string>('Dialectal English');
	const [salesLanguage, setSalesLanguage] = useState<string>('Dialectal English');
	const [orderingLanguage, setOrderingLanguage] = useState<string>('Dialectal English');

	/**
	 * Utility for formatting the timing of logs
	 */
	const formatTime = useCallback((timestamp: string) => {
		const startTime = startTimeRef.current;
		const t0 = new Date(startTime).valueOf();
		const t1 = new Date(timestamp).valueOf();
		const delta = t1 - t0;
		const hs = Math.floor(delta / 10) % 100;
		const s = Math.floor(delta / 1000) % 60;
		const m = Math.floor(delta / 60_000) % 60;
		const pad = (n: number) => {
			let s = n + '';
			while (s.length < 2) {
				s = '0' + s;
			}
			return s;
		};
		return `${pad(m)}:${pad(s)}.${pad(hs)}`;
	}, []);

	/**
	 * When you click the API key
	 */
	const resetAPIKey = useCallback(() => {
		const apiKey = prompt('OpenAI API Key');
		if (apiKey !== null) {
			localStorage.clear();
			localStorage.setItem('tmp::voice_api_key', apiKey);
			window.location.reload();
		}
	}, []);

	/**
	 * Connect to conversation:
	 * WavRecorder taks speech input, WavStreamPlayer output, client is API client
	 */
	const connectConversation = useCallback(async () => {

		const client = clientRef.current;
		const wavRecorder = wavRecorderRef.current;
		const wavStreamPlayer = wavStreamPlayerRef.current;

		// Set state variables
		startTimeRef.current = new Date().toISOString();
		setIsConnected(true);
		setRealtimeEvents([]);
		setItems(client.conversation.getItems());

		// Connect to microphone
		await wavRecorder.begin();

		// Connect to audio output
		await wavStreamPlayer.connect();

		// Connect to realtime API
		await client.connect();
		client.sendUserMessageContent([
			{
				type: `input_text`,
				text: `Hello!`,
			},
		]);

		if (client.getTurnDetectionType() === 'server_vad') {
			await wavRecorder.record((data) => client.appendInputAudio(data.mono));
		}
	}, []);

	/**
	 * Disconnect and reset conversation state
	 */
	const disconnectConversation = useCallback(async () => {
		const client = clientRef.current;
		if (client.isConnected()) {
			setIsConnected(false);
			setRealtimeEvents([]);
			setItems([]);
			setMemoryKv({});
			setCoords({
				lat: 37.775593,
				lng: -122.418137,
			});
			setMarker(null);

			client.disconnect();

			const wavRecorder = wavRecorderRef.current;
			await wavRecorder.end();

			const wavStreamPlayer = wavStreamPlayerRef.current;
			await wavStreamPlayer.interrupt();
		}

	}, []);

	/**
	 * Switch between Manual <> VAD mode for communication
	 */
	const changeTurnEndType = async (value: string) => {
		const client = clientRef.current;
		const wavRecorder = wavRecorderRef.current;
		if (value === 'none' && wavRecorder.getStatus() === 'recording') {
			await wavRecorder.pause();
		}
		client.updateSession({
			turn_detection: value === 'none' ? null : { type: 'server_vad' },
		});
		if (value === 'server_vad' && client.isConnected()) {
			await wavRecorder.record((data) => client.appendInputAudio(data.mono));
		}
		setCanPushToTalk(value === 'none');
	};

	/**
	 * Auto-scroll the event logs
	 */
	useEffect(() => {
		if (eventsScrollRef.current) {
			const eventsEl = eventsScrollRef.current;
			const scrollHeight = eventsEl.scrollHeight;
			// Only scroll if height has just changed
			if (scrollHeight !== eventsScrollHeightRef.current) {
				eventsEl.scrollTop = scrollHeight;
				eventsScrollHeightRef.current = scrollHeight;
			}
		}
	}, [realtimeEvents]);

	/**
	 * Auto-scroll the conversation logs
	 */
	useEffect(() => {
		const conversationEls = [].slice.call(
			document.body.querySelectorAll('[data-conversation-content]')
		);
		for (const el of conversationEls) {
			const conversationEl = el as HTMLDivElement;
			conversationEl.scrollTop = conversationEl.scrollHeight;
		}
	}, [items]);

	/**
	 * Set up render loops for the visualization canvas
	 */
	useEffect(() => {
		let isLoaded = true;

		const wavRecorder = wavRecorderRef.current;
		const clientCanvas = clientCanvasRef.current;
		let clientCtx: CanvasRenderingContext2D | null = null;

		const wavStreamPlayer = wavStreamPlayerRef.current;
		const serverCanvas = serverCanvasRef.current;
		let serverCtx: CanvasRenderingContext2D | null = null;

		const render = () => {
			if (isLoaded) {
				if (clientCanvas) {
					if (!clientCanvas.width || !clientCanvas.height) {
						clientCanvas.width = clientCanvas.offsetWidth;
						clientCanvas.height = clientCanvas.offsetHeight;
					}
					clientCtx = clientCtx || clientCanvas.getContext('2d');
					if (clientCtx) {
						clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
						const result = wavRecorder.recording
							? wavRecorder.getFrequencies('voice')
							: { values: new Float32Array([0]) };
						WavRenderer.drawBars(
							clientCanvas,
							clientCtx,
							result.values,
							'#0099ff',
							10,
							0,
							8
						);
					}
				}
				if (serverCanvas) {
					if (!serverCanvas.width || !serverCanvas.height) {
						serverCanvas.width = serverCanvas.offsetWidth;
						serverCanvas.height = serverCanvas.offsetHeight;
					}
					serverCtx = serverCtx || serverCanvas.getContext('2d');
					if (serverCtx) {
						serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
						const result = wavStreamPlayer.analyser
							? wavStreamPlayer.getFrequencies('voice')
							: { values: new Float32Array([0]) };
						WavRenderer.drawBars(
							serverCanvas,
							serverCtx,
							result.values,
							'#009900',
							10,
							0,
							8
						);
					}
				}
				window.requestAnimationFrame(render);
			}
		};
		render();

		return () => {
			isLoaded = false;
		};
	}, []);

	/**
	 * Core RealtimeClient and audio capture setup
	 * Set all of our instructions, tools, events and more
	 */
	useEffect(() => {
		// Get refs
		const wavStreamPlayer = wavStreamPlayerRef.current;
		const client = clientRef.current;

		// Set instructions
		// client.updateSession({
		// 	instructions: ai_travel_instructions_english
		// });
		client.updateSession({ voice: 'coral' }); // Set specific voice for AI

		client.updateSession({
			instructions: ai_travel_instructions.replace('{LANGUAGE}', travelLanguage)
		});

		client.updateSession({
			temperature: 0.6
		});
		// Set transcription, otherwise we don't get user transcriptions back
		// client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });
		client.updateSession({
			turn_detection: { type: 'server_vad' },
			input_audio_transcription: { model: 'whisper-1' }
		});

		// Add tools

		client.addTool(
			{
				name: 'save_user_and_order_info',
				description: 'Saves and updates user and order information throughout the conversation. Each call will update the specified fields while preserving other existing information.',
				parameters: {
					type: 'object',
					properties: {
						customer_name: {
							type: 'string',
							description: "Customer's full name (mandatory)"
						},
						address: {
							type: 'string',
							description: 'Delivery or billing address of the user (mandatory)'
						},
						phone_number: {
							type: 'string',
							description: "Customer's phone number (mandatory)"
						},
						order_details_with_quantity: {
							type: 'string',
							description: 'Details of the items ordered - order details with quantity of each item, comma separated in case of multiple items (mandatory)'
						},
						payment_method: {
							type: 'string',
							description: 'Method of payment (e.g., credit card, cash, etc.) (mandatory)'
						},
						order_summary_with_confirmation_and_est_time: {
							type: 'string',
							description: 'Summarize the user’s order with important details, provide a confirmation number, and state that the order will be delivered within 30-45 minutes (mandatory)'
						}
					},
					required: [
						'customer_name',
						'address',
						'phone_number',
						'order_details_with_quantity',
						'payment_method',
						'order_summary_with_confirmation_and_est_time'
					]
				}
			},
			async (params: {
				customer_name?: string,
				address?: string,
				phone_number?: string,
				order_details_with_quantity?: string,
				payment_method?: string,
				order_summary_with_confirmation_and_est_time?: string
			}) => {
				// Update the memoryKv state while preserving existing data
				setMemoryKv((currentMemoryKv) => {
					const newKv = { ...currentMemoryKv };

					// Only update the fields that are provided
					if (params.customer_name) {
						newKv.customer_name = params.customer_name;
					}
					if (params.address) {
						newKv.address = params.address;
					}
					if (params.phone_number) {
						newKv.phone_number = params.phone_number;
					}
					if (params.order_details_with_quantity) {
						newKv.order_details_with_quantity = params.order_details_with_quantity;
					}
					if (params.payment_method) {
						newKv.payment_method = params.payment_method;
					}
					if (params.order_summary_with_confirmation_and_est_time) {
						newKv.order_summary_with_confirmation_and_est_time = params.order_summary_with_confirmation_and_est_time;
					}

					// Add timestamp for tracking updates
					newKv.last_updated = new Date().toISOString();

					return newKv;
				});

				return {
					ok: true,
					message: 'Order information updated successfully'
				};
			}
		);

		client.addTool(
			{
				name: 'save_travel_user_and_airline_booking_information',
				description: 'Saves and updates user and order information throughout the conversation. Each call will update the specified fields while preserving other existing information.',
				parameters: {
					type: 'object',
					properties: {
						passenger_names: {
							type: 'string',
							description: "Names of the passenger(s) travelling ,comma seperated in case of multiple users"
						},
						departure: {
							type: 'string',
							description: 'departure city or airport'
						},
						arrival: {
							type: 'string',
							description: 'arrival city or airport'
						},
						date_and_time_of_journey: {
							type: 'string',
							description: 'Date , day and time of journey'
						},
						flight_details: {
							type: 'string',
							description: 'Flight number and any additional details'
						},
						cabin_class_type: {
							type: 'string',
							description: 'class of cabin based on users preference(e.g. economy , business or first class)'
						},
						special_requests: {
							type: 'string',
							description: 'Any special requests e.g., Seat related information or other preferences'
						},
						final_booking_confirmation: {
							type: 'string',
							description: 'Booking confirmation number along with booking details'
						}
					},
					// Making all parameters optional so we can update them individually
					required: ['passenger_names', 'departure', 'arrival', 'date_and_time_of_journey', 'flight_details', 'cabin_class_type', 'special_requests', 'final_booking_confirmation']
				}
			},
			async (params: {
				passenger_names?: string,
				departure?: string,
				arrival?: string,
				date_and_time_of_journey?: string,
				flight_details?: string,
				cabin_class_type?: string,
				special_requests?: string,
				final_booking_confirmation?: string
			}) => {
				// Update the memoryKv state while preserving existing data
				setMemoryKv((currentMemoryKv) => {
					const newKv = { ...currentMemoryKv };

					// Only update the fields that are provided
					if (params.passenger_names) {
						newKv.passenger_names = params.passenger_names;
					}
					if (params.departure) {
						newKv.departure = params.departure;
					}
					if (params.arrival) {
						newKv.arrival = params.arrival;
					}
					if (params.date_and_time_of_journey) {
						newKv.date_and_time_of_journey = params.date_and_time_of_journey;
					}
					if (params.flight_details) {
						newKv.flight_details = params.flight_details;
					}
					if (params.cabin_class_type) {
						newKv.cabin_class_type = params.cabin_class_type;
					}
					if (params.special_requests) {
						newKv.special_requests = params.special_requests;
					}
					if (params.final_booking_confirmation) {
						newKv.final_booking_confirmation = params.final_booking_confirmation;
					}

					// Add timestamp for tracking updates
					newKv.last_updated = new Date().toISOString();

					return newKv;
				});

				return {
					ok: true,
					message: 'Booking information updated successfully'
				};
			}
		);

		// client.addTool(
		// 	{
		// 		name: 'get_weather',
		// 		description:
		// 			'Retrieves the weather for a given lat, lng coordinate pair. Specify a label for the location.',
		// 		parameters: {
		// 			type: 'object',
		// 			properties: {
		// 				lat: {
		// 					type: 'number',
		// 					description: 'Latitude',
		// 				},
		// 				lng: {
		// 					type: 'number',
		// 					description: 'Longitude',
		// 				},
		// 				location: {
		// 					type: 'string',
		// 					description: 'Name of the location',
		// 				},
		// 			},
		// 			required: ['lat', 'lng', 'location'],
		// 		},
		// 	},
		// 	async ({ lat, lng, location }: { [key: string]: any }) => {
		// 		setMarker({ lat, lng, location });
		// 		setCoords({ lat, lng, location });
		// 		const result = await fetch(
		// 			`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m`
		// 		);
		// 		const json = await result.json();
		// 		const temperature = {
		// 			value: json.current.temperature_2m as number,
		// 			units: json.current_units.temperature_2m as string,
		// 		};
		// 		const wind_speed = {
		// 			value: json.current.wind_speed_10m as number,
		// 			units: json.current_units.wind_speed_10m as string,
		// 		};
		// 		setMarker({ lat, lng, location, temperature, wind_speed });
		// 		return json;
		// 	}
		// );

		// handle realtime events from client + server for event logging
		client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
			setRealtimeEvents((realtimeEvents) => {
				const lastEvent = realtimeEvents[realtimeEvents.length - 1];
				if (lastEvent?.event.type === realtimeEvent.event.type) {
					// if we receive multiple events in a row, aggregate them for display purposes
					lastEvent.count = (lastEvent.count || 0) + 1;
					return realtimeEvents.slice(0, -1).concat(lastEvent);
				} else {
					return realtimeEvents.concat(realtimeEvent);
				}
			});
		});
		client.on('error', (event: any) => console.error(event));
		client.on('conversation.interrupted', async () => {
			const trackSampleOffset = await wavStreamPlayer.interrupt();
			if (trackSampleOffset?.trackId) {
				const { trackId, offset } = trackSampleOffset;
				await client.cancelResponse(trackId, offset);
			}
		});
		client.on('conversation.updated', async ({ item, delta }: any) => {
			const items = client.conversation.getItems();
			if (delta?.audio) {
				wavStreamPlayer.add16BitPCM(delta.audio, item.id);
			}
			if (item.status === 'completed' && item.formatted.audio?.length) {
				const wavFile = await WavRecorder.decode(
					item.formatted.audio,
					24000,
					24000
				);
				item.formatted.file = wavFile;
			}
			setItems(items);
		});

		setItems(client.conversation.getItems());

		return () => {
			// cleanup; resets to defaults
			client.reset();
		};
	}, []);

	const handleChangeRole = async (newRole: string) => {
		setRole(newRole);

		// Disconnect the current session
		await disconnectConversation();

		// Update instructions based on the selected role and its language
		const client = clientRef.current;
		let instructions;

		switch (newRole) {
			case 'Sales':
				instructions = getInstructionsForSales(salesLanguage);
				break;
			case 'Ordering':
				instructions = getInstructionsForOrdering(orderingLanguage);
				break;
			default: // 'Travel'
				instructions = getInstructionsForTravel(travelLanguage);
		}

		// Update the session with new instructions
		client.updateSession({ instructions });

		// Reconnect with the new instructions
		await connectConversation();
	};

	const handleChangeLanguage = async (e: React.ChangeEvent<HTMLSelectElement>, languageRole: string) => {
		e.stopPropagation();
		if (role !== languageRole) {
			// If they don't match, show an alert and return early
			alert(`Please select the "${languageRole}" role before changing its language.`);
			// Reset the select element to its previous value
			e.target.value = languageRole === 'Travel' ? travelLanguage : languageRole === 'Sales' ? salesLanguage : orderingLanguage;
			return;
		}
		const newLanguage = e.target.value;

		// Disconnect the current session
		await disconnectConversation();

		// Update language state and instructions based on the role
		const client = clientRef.current;
		let instructions;

		switch (languageRole) {
			case 'Sales':
				setSalesLanguage(newLanguage);
				instructions = getInstructionsForSales(newLanguage);
				break;
			case 'Ordering':
				setOrderingLanguage(newLanguage);
				instructions = getInstructionsForOrdering(newLanguage);
				break;
			default: // 'Travel'
				setTravelLanguage(newLanguage);
				instructions = getInstructionsForTravel(newLanguage);
		}

		// Update the session with new instructions
		client.updateSession({ instructions });

		// Reconnect with the new instructions
		await connectConversation();
	};

	const getInstructionsForTravel = (language: string) => {
		return ai_travel_instructions.replace('{LANGUAGE}', language);
	};

	const getInstructionsForSales = (language: string) => {
		return ai_sales_instructions.replace('{LANGUAGE}', language);
	};

	const getInstructionsForOrdering = (language: string) => {
		return ai_ordering_instructions.replace('{LANGUAGE}', language);
	};

	return (
		<div data-component="ConsolePage" className='overflow-y-scroll lg:overflow-hidden'>
			{/* Navbar */}
			<div className="flex items-center justify-between h-[80px] lg:h-[100px] px-[20px] md:px-[40px] lg:px-[100px] border-none bg-[#002154]">

				<svg width="150" height="50" viewBox="0 0 190 50" fill="none" xmlns="http://www.w3.org/2000/svg">
					<g clip-path="url(#clip0_1091_4705)">
						<path d="M61.0472 41.9151H57.7297C51.6836 41.9151 47.125 37.6931 47.125 32.0924V21.6152H51.5311V32.0924C51.5311 35.3094 54.0814 37.5562 57.7297 37.5562H61.0472V41.9151Z" fill="white" />
						<path d="M66.3426 21.6172H61.9365V32.9091H66.3426V21.6172Z" fill="white" />
						<path d="M80.7763 29.6672L89.7316 21.6178H83.5377L76.105 28.0286V14.4551H71.896V41.9154H76.105V33.1209L77.067 32.3387L84.1547 41.9154H89.7715L80.7763 29.6672Z" fill="white" />
						<path d="M103.712 37.6514C100.141 37.6514 97.6473 35.4534 97.6473 32.3083V25.9858H106.809V21.6269H97.6473V14.7705H93.3374V32.3107C93.3374 37.7883 97.7975 41.9175 103.712 41.9175H106.809V37.6537H103.712V37.6514Z" fill="white" />
						<path d="M190 21.5996H185.582V25.9701H190V21.5996Z" fill="white" />
						<path d="M189.988 29.1914H185.582V41.9154H189.988V29.1914Z" fill="white" />
						<path d="M123.913 41.2768C123.974 41.2536 124.032 41.2304 124.093 41.2072C124.152 41.1816 124.213 41.1561 124.272 41.1306C124.363 41.0911 124.455 41.0517 124.544 41.0076C124.57 40.9959 124.596 40.982 124.621 40.9704C125.534 40.5317 126.388 39.9399 127.146 39.1902H127.144C128.847 37.5028 129.9 35.1771 129.9 32.6123C129.9 30.0476 128.844 27.7219 127.144 26.0368H127.146C126.388 25.2848 125.534 24.6929 124.621 24.2542C124.596 24.2426 124.572 24.2287 124.546 24.2171C124.455 24.1753 124.363 24.1335 124.272 24.0941C124.213 24.0686 124.154 24.043 124.096 24.0198C124.035 23.9943 123.976 23.9734 123.915 23.9479C123.824 23.913 123.73 23.8759 123.636 23.8434C123.608 23.8341 123.58 23.8248 123.554 23.8156C122.594 23.4883 121.567 23.3096 120.499 23.3096V23.3142C118.092 23.3142 115.682 24.2217 113.85 26.0345C112.018 27.8472 111.1 30.2309 111.1 32.6123H111.096C111.096 33.6707 111.279 34.6873 111.61 35.6367C111.619 35.6645 111.628 35.69 111.638 35.7179C111.671 35.8107 111.708 35.9036 111.743 35.9964C111.767 36.0568 111.79 36.1148 111.814 36.1728C111.839 36.2308 111.865 36.2912 111.891 36.3492C111.931 36.4397 111.971 36.5303 112.015 36.6185C112.027 36.644 112.041 36.6695 112.053 36.6951C112.496 37.5979 113.095 38.4428 113.852 39.1925C114.608 39.9399 115.464 40.5317 116.375 40.9727C116.4 40.9843 116.426 40.9983 116.454 41.0122C116.544 41.054 116.635 41.0934 116.727 41.1329C116.785 41.1584 116.846 41.184 116.905 41.2095C116.963 41.2327 117.024 41.2559 117.083 41.2791C117.177 41.3163 117.271 41.3511 117.365 41.3836C117.39 41.3929 117.419 41.4021 117.444 41.4114C118.404 41.7387 119.432 41.9197 120.502 41.9197C121.571 41.9197 122.599 41.7387 123.559 41.4114C123.587 41.4021 123.613 41.3929 123.641 41.3836C123.735 41.3511 123.828 41.3139 123.922 41.2791L123.913 41.2768ZM116.926 29.082C118.331 27.6917 120.368 27.2948 122.132 27.8913C122.146 27.896 122.163 27.9006 122.177 27.9076C122.226 27.9261 122.278 27.9447 122.327 27.9633C122.36 27.9749 122.393 27.9888 122.425 28.0004C122.456 28.0143 122.489 28.0283 122.519 28.0399C122.568 28.0608 122.618 28.084 122.667 28.1049C122.681 28.1118 122.695 28.1188 122.707 28.1257C124.382 28.9381 125.539 30.6441 125.539 32.61C125.539 34.5759 124.382 36.2819 122.707 37.0943C122.693 37.1012 122.679 37.1082 122.665 37.1152C122.615 37.1384 122.568 37.1593 122.519 37.1802C122.486 37.1941 122.456 37.208 122.423 37.2219C122.39 37.2359 122.36 37.2475 122.327 37.2591C122.278 37.2776 122.226 37.2985 122.177 37.3148C122.163 37.3194 122.146 37.3241 122.132 37.3287C121.072 37.6885 119.913 37.6885 118.852 37.3287C118.838 37.3241 118.824 37.3194 118.81 37.3148C118.758 37.2962 118.709 37.2776 118.657 37.2591C118.625 37.2475 118.594 37.2359 118.564 37.2219C118.531 37.208 118.498 37.1941 118.467 37.1802C118.418 37.1593 118.371 37.1384 118.322 37.1152C118.308 37.1082 118.294 37.1012 118.28 37.0943C117.273 36.6069 116.454 35.7968 115.962 34.8011C115.955 34.7871 115.948 34.7732 115.941 34.7593C115.917 34.7129 115.896 34.6641 115.875 34.6154C115.861 34.5829 115.847 34.5527 115.833 34.5202C115.819 34.4877 115.807 34.4576 115.795 34.4251C115.776 34.3763 115.755 34.3253 115.739 34.2765C115.734 34.2626 115.729 34.2463 115.725 34.2324C115.122 32.4847 115.521 30.4723 116.928 29.0797L116.926 29.082Z" fill="white" />
						<path d="M142.781 23.3094C140.922 23.3094 139.189 23.8502 137.729 24.774V14.9072H133.382V32.6888C133.403 35.2071 134.44 37.491 136.108 39.1575C136.117 39.1668 136.127 39.1784 136.139 39.1877C136.169 39.2179 136.202 39.248 136.235 39.2782C137.929 40.9099 140.24 41.9149 142.785 41.9149C147.97 41.9149 152.189 37.7417 152.189 32.6122C152.189 27.4827 147.966 23.3094 142.778 23.3094H142.781ZM142.785 37.6047C141.403 37.6047 140.148 37.05 139.236 36.1564C139.231 36.1518 139.224 36.1471 139.219 36.1402C139.214 36.1355 139.21 36.1286 139.203 36.1239C138.299 35.221 137.739 33.9793 137.739 32.6122C137.739 29.8594 140.003 27.6196 142.785 27.6196C145.568 27.6196 147.832 29.8594 147.832 32.6122C147.832 35.3649 145.568 37.6047 142.785 37.6047Z" fill="white" />
						<path d="M181.544 32.6127H181.539V32.4479H181.535C181.492 30.1199 180.58 27.8058 178.79 26.0325C176.957 24.2198 174.548 23.3123 172.141 23.3123V23.3076C171.071 23.3076 170.043 23.4887 169.084 23.8159C169.055 23.8252 169.03 23.8345 169.001 23.8438C168.908 23.8763 168.814 23.9134 168.72 23.9482C168.659 23.9714 168.6 23.9946 168.539 24.0179C168.481 24.0434 168.42 24.0689 168.361 24.0945C168.269 24.1339 168.178 24.1734 168.089 24.2175C168.063 24.2291 168.037 24.243 168.011 24.2546C167.099 24.6933 166.245 25.2851 165.487 26.0348C164.731 26.7822 164.133 27.6294 163.69 28.53C163.676 28.5555 163.664 28.581 163.65 28.6089C163.608 28.6971 163.568 28.7876 163.528 28.8781C163.502 28.9362 163.476 28.9965 163.45 29.0545C163.427 29.1126 163.403 29.1729 163.38 29.2309C163.342 29.3238 163.307 29.4166 163.274 29.5095C163.265 29.535 163.256 29.5628 163.246 29.5884C162.915 30.5377 162.732 31.5543 162.732 32.6127C162.732 33.6711 162.915 34.6877 163.246 35.637C163.256 35.6649 163.265 35.6904 163.274 35.7183C163.307 35.8111 163.345 35.9039 163.38 35.9968C163.403 36.0571 163.427 36.1152 163.45 36.1732C163.476 36.2312 163.502 36.2916 163.528 36.3496C163.568 36.4401 163.608 36.5306 163.652 36.6188C163.664 36.6444 163.678 36.6699 163.69 36.6954C164.133 37.5983 164.731 38.4432 165.489 39.1929H165.492C167.195 40.8733 169.546 41.9178 172.138 41.9178C173.992 41.9178 175.718 41.3839 177.175 40.4648V41.9178H181.537V32.7845C181.537 32.7264 181.542 32.6707 181.542 32.6127H181.544ZM172.141 37.6053C170.151 37.6053 168.429 36.461 167.608 34.8038C167.601 34.7898 167.594 34.7759 167.587 34.762C167.563 34.7132 167.542 34.6668 167.521 34.6181C167.507 34.5856 167.493 34.5554 167.479 34.5229C167.465 34.4904 167.453 34.4603 167.441 34.4278C167.422 34.379 167.401 34.328 167.385 34.2792C167.38 34.2653 167.375 34.249 167.371 34.2351C167.007 33.186 167.007 32.0394 167.371 30.9903C167.375 30.9764 167.38 30.9624 167.385 30.9485C167.404 30.8974 167.422 30.8487 167.441 30.7976C167.453 30.7651 167.465 30.735 167.479 30.7025C167.493 30.67 167.507 30.6398 167.521 30.6073C167.542 30.5586 167.563 30.5121 167.587 30.4634C167.594 30.4495 167.601 30.4356 167.608 30.4216C168.1 29.4259 168.919 28.6159 169.926 28.1284C169.94 28.1215 169.954 28.1145 169.968 28.1075C170.017 28.0843 170.067 28.0634 170.113 28.0426C170.146 28.0286 170.177 28.0147 170.21 28.0008C170.243 27.9868 170.273 27.9752 170.306 27.9636C170.355 27.9451 170.407 27.9242 170.456 27.9079C170.47 27.9033 170.487 27.8986 170.501 27.894C172.267 27.2975 174.301 27.6944 175.707 29.0847C176.648 30.0154 177.138 31.227 177.178 32.4502V32.8564C177.154 33.3229 177.065 33.7871 176.91 34.2351C176.906 34.249 176.901 34.2653 176.894 34.2792C176.875 34.328 176.856 34.3767 176.838 34.4254C176.826 34.4579 176.812 34.4904 176.8 34.5229C176.786 34.5531 176.772 34.5856 176.76 34.6158C176.739 34.6645 176.716 34.7132 176.694 34.762C176.687 34.7759 176.68 34.7898 176.673 34.8014C175.852 36.4587 174.128 37.6029 172.141 37.6029V37.6053Z" fill="white" />
						<path d="M159.727 37.54H155.302V41.9175H159.727V37.54Z" fill="white" />
						<path d="M7.01981 12.9077L6.97524 28.5794C6.96351 32.5925 9.76483 37.0002 13.7862 39.298L18.6404 42.0717L18.6169 50.0004L13.7627 47.2267C5.89365 42.7309 -0.0233922 33.001 6.95263e-05 24.5942L0.0446468 8.9248L7.01981 12.9077Z" fill="#0047AF" />
						<path d="M0.0444336 8.92443L15.616 0L22.5911 3.98292L7.0196 12.9073L0.0444336 8.92443Z" fill="#4283F2" />
						<path d="M25.7162 23.5858L25.6646 41.2954L18.6895 37.3125L18.7411 19.6006L25.7162 23.5858Z" fill="#0047AF" />
						<path d="M18.7412 19.6008L34.3128 10.6787L41.2879 14.6616L25.7164 23.5861L18.7412 19.6008Z" fill="#4283F2" />
					</g>
					<defs>
						<clipPath id="clip0_1091_4705">
							<rect width="190" height="50" fill="white" />
						</clipPath>
					</defs>
				</svg>

				<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
					<div className='hidden md:flex items-center justify-center w-fit h-[50px] px-5 text-base text-white cursor-pointer'>
						Try for free
					</div>
					<div className='flex items-center justify-center w-fit h-[50px] px-5 text-base text-white cursor-pointer glassmorphism rounded-[50px] bg-[#FFF]/10 hover:bg-[#FFF]/20 transition-all ease-in-out duration-300' onClick={() => window.open('https://workforce.uktob.ai/hireRaya')}>
						Get in touch
					</div>
				</div>
			</div>

			<div className='content-bottom'>
				<div className='content-bg'>
					<img
						src={AutonomousBg}
						alt="autonomous-bg"
						style={{ width: '100%' }}
					/>
				</div>
				<h1 className='text-2xl md:text-5xl xl:text-6xl font-bold text-center bg-gradient-to-r from-white to-stone-300 inline-block text-transparent bg-clip-text'>Voice AI for Customer Support</h1>
				<p className="text-sm md:text-base lg:text-lg mt-5 lg:mt-8" style={{ color: '#FFF', opacity: 0.8, textAlign: 'center', lineHeight: '28px' }}>Deploy Autonomous AI Teammates that take on key</p>
				<p className="text-sm md:text-base lg:text-lg" style={{ margin: 0, color: '#FFF', opacity: 0.8, textAlign: 'center', lineHeight: '28px' }}>business functions within minutes.</p>
				<div className='content-recorder w-[300px] h-[250px]'>

					<div
						style={{ cursor: 'pointer' }}
						onClick={isConnected ? disconnectConversation : connectConversation}
						onMouseEnter={() => setIsHovering(true)}
						onMouseLeave={() => setIsHovering(false)}
					>
						{
							isConnected
								?
								<Lottie
									loop
									animationData={sphereAnimation}
									play
									className='transition-all ease-in-out duration-300'
									style={{ width: '200px', height: '200px', filter: `${isHovering ? 'drop-shadow(0 0 50px rgba(255, 205, 203, 0.75))' : 'drop-shadow(0 0 50px rgba(255, 205, 203, 0.5))'} ` }}
								/>
								:
								<div>
									<img
										id="sphere-img"
										src={sphereImg}
										className="floating-sphere transition-all ease-in-out duration-300"
										style={{ filter: `${isHovering ? 'drop-shadow(0 0 50px rgba(255, 205, 203, 0.75))' : 'drop-shadow(0 0 50px rgba(255, 205, 203, 0.5))'} ` }}
									/>
								</div>
						}
					</div>

					{
						isConnected
							?
							<div className='glass-btn' style={{ minWidth: '130px', height: '32px' }}>
								<p>{isHovering ? "Press to stop" : "Raya is listening!"}</p>
							</div>
							:
							<div className='glass-btn absolute -bottom-10 lg:bottom-0 bg-[#FFF]/10 hover:bg-[#FFF]/20 transition-all ease-in-out duration-300' style={{ minWidth: '100px', height: '32px' }}>
								<p>Give it a try!</p>
							</div>
					}

				</div>

				<div className='flex flex-col lg:flex-row items-center justify-center gap-x-5 p-2 mt-10 gap-y-5'>

					{/* card */}
					<div className='w-full md:w-[400px] bg-[#FFF]/10 hover:bg-[#FFF]/20 transition-all ease-in-out duration-300 glassmorphism rounded-xl cursor-pointer' onClick={() => handleChangeRole('Travel')}>
						<div className="w-full p-4">

							<Field>
								<div className='w-full flex items-center justify-between'>
									<Label className="text-sm/6 font-medium text-white">AI Travel Concierge</Label>
									{
										role === 'Travel' &&
										<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#FFF" className="size-5">
											<path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
										</svg>
									}
								</div>

								<Description className="text-sm/6 text-white/50">Please select the language and dialect for the voice model</Description>
								<div className="relative" onClick={(e) => e.stopPropagation()}>
									<Select
										disabled={role !== 'Travel'}
										value={travelLanguage}
										onChange={(e) => handleChangeLanguage(e, 'Travel')}
										className={clsx(
											'mt-3 block w-full appearance-none rounded-lg border border-[#FFF]/20 bg-white/5 py-1.5 px-3 text-sm/6 text-white cursor-pointer',
											'focus:outline-none data-[focus]:outline-2 data-[focus]:-outline-offset-2 data-[focus]:outline-white/25',
											// Make the text of each option black on Windows
											'*:text-black'
										)}
									>
										<option value="Dialectal English">English</option>
										<option value="Dialectal Saudi">Saudi</option>
										<option value="Dialectal Lebanese">Lebanese</option>
										<option value="Dialectal Jordanian">Jordanian</option>
										<option value="Dialectal Emirati">Emirati</option>
									</Select>
									<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#FFF" className="group pointer-events-none absolute top-2.5 right-2.5 size-4">
										<path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
									</svg>
								</div>
							</Field>
						</div>
					</div>

					<div className='w-full md:w-[400px] bg-[#FFF]/10 hover:bg-[#FFF]/20 transition-all ease-in-out duration-300 glassmorphism rounded-xl cursor-pointer' onClick={() => handleChangeRole('Sales')}>
						<div className="w-full p-4">

							<Field>
								<div className='w-full flex items-center justify-between'>
									<Label className="text-sm/6 font-medium text-white">AI E-Commerce Sales & Support Representative</Label>
									{
										role === 'Sales' &&
										<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#FFF" className="size-5">
											<path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
										</svg>
									}
								</div>

								<Description className="text-sm/6 text-white/50">Please select the language and dialect for the voice model</Description>
								<div className="relative" onClick={(e) => e.stopPropagation()}>
									<Select
										disabled={role !== 'Sales'}
										value={salesLanguage}
										onChange={(e) => handleChangeLanguage(e, 'Sales')}
										className={clsx(
											'mt-3 block w-full appearance-none rounded-lg border border-[#FFF]/20 bg-white/5 py-1.5 px-3 text-sm/6 text-white cursor-pointer',
											'focus:outline-none data-[focus]:outline-2 data-[focus]:-outline-offset-2 data-[focus]:outline-white/25',
											// Make the text of each option black on Windows
											'*:text-black'
										)}
									>
										<option value="Dialectal English">English</option>
										<option value="Dialectal Saudi">Saudi</option>
										<option value="Dialectal Lebanese">Lebanese</option>
										<option value="Dialectal Jordanian">Jordanian</option>
										<option value="Dialectal Emirati">Emirati</option>
									</Select>
									<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#FFF" className="group pointer-events-none absolute top-2.5 right-2.5 size-4">
										<path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
									</svg>
								</div>
							</Field>
						</div>
					</div>

					<div className='w-full md:w-[400px] bg-[#FFF]/10 hover:bg-[#FFF]/20 transition-all ease-in-out duration-300 glassmorphism rounded-xl cursor-pointer' onClick={() => handleChangeRole('Ordering')}>
						<div className="w-full p-4">

							<Field>
								<div className='w-full flex items-center justify-between'>
									<Label className="text-sm/6 font-medium text-white">AI Digital Ordering Concierge</Label>
									{
										role === 'Ordering' &&
										<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#FFF" className="size-5">
											<path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
										</svg>
									}
								</div>

								<Description className="text-sm/6 text-white/50">Please select the language and dialect for the voice model</Description>
								<div className="relative" onClick={(e) => e.stopPropagation()}>
									<Select
										disabled={role !== 'Ordering'}
										value={orderingLanguage}
										onChange={(e) => handleChangeLanguage(e, 'Ordering')}
										className={clsx(
											'mt-3 block w-full appearance-none rounded-lg border border-[#FFF]/20 bg-white/5 py-1.5 px-3 text-sm/6 text-white cursor-pointer',
											'focus:outline-none data-[focus]:outline-2 data-[focus]:-outline-offset-2 data-[focus]:outline-white/25',
											// Make the text of each option black on Windows
											'*:text-black'
										)}
									>
										<option value="Dialectal English">English</option>
										<option value="Dialectal Saudi">Saudi</option>
										<option value="Dialectal Lebanese">Lebanese</option>
										<option value="Dialectal Jordanian">Jordanian</option>
										<option value="Dialectal Emirati">Emirati</option>
									</Select>
									<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#FFF" className="group pointer-events-none absolute top-2.5 right-2.5 size-4">
										<path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
									</svg>
								</div>
							</Field>
						</div>
					</div>


				</div>
			</div>
		</div >
	);
}

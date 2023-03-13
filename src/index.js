import { env } from 'process';
import fastify from "fastify";
import fastify_static from "fastify-static";
import path from "path";
import pov from "point-of-view";
import njk from "nunjucks";
import SQLite from "./stores/sqlite.js";
import TMDB from "./providers/tmdb.js";

	const TMDB_KEY = env.TMDB_KEY;
	const Provider = new TMDB(TMDB_KEY);
	const Store = new SQLite("data/db.db");
	await Store.open();

	// Require the framework and instantiate it
	const app = fastify({ logger: true })
	app.register(pov, {
		engine: {
			nunjucks: njk 
		},
		options : {
			onConfigure: (env) => {
				env.addFilter("pad", function(s){ return String(s).padStart(2, "0"); });
				env.addFilter("year", function(s){ return new Date(s).getFullYear(); });
				env.addFilter("date", function(s){
					const date = new Date(s);
					return date.toLocaleString('es-AR', {
						weekday: 'short', // long, short, narrow
						day: 'numeric', // numeric, 2-digit
						year: 'numeric', // numeric, 2-digit
						month: 'long', // numeric, 2-digit, long, short, narrow
						hour: 'numeric', // numeric, 2-digit
						minute: 'numeric', // numeric, 2-digit
						second: 'numeric', // numeric, 2-digit
					})
				});
			}
		}
	});
	app.register(fastify_static, {
		root: path.resolve('data/assets'),
		prefix: "/assets/"
	});

	// Declare a route
	app.get('/', async (request, reply) => {
		const series = await Store.getLastSeries();
		const finished = series.filter( i => i.finished );
		const unfinished = series.filter( i => !i.finished );

		const movies = await Store.getLastMovies();

		const history = finished.concat(movies).sort((a,b) => new Date(b.watched) - new Date(a.watched) );
		return reply.view('templates/index.njk', { unfinished, history })
	})

	app.get('/episode/watch/:id', async (request,reply) => {
		await Store.watchEpisode(request.params.id);
		const data = await Store.getChapter(request.params.id);

		reply.redirect(`/tv/${data.serie_id}`);
	});

	app.get('/episode/unwatch/:id', async (request,reply) => {
		await Store.unwatchEpisode(request.params.id);
		const data = await Store.getChapter(request.params.id);

		reply.redirect(`/tv/${data.serie_id}`);
	});

	app.get('/tv/:id/add', async (request,reply) => {
		const data = await Provider.getSerie(request.params.id);
		await Store.addSerie(data);
		reply.redirect(`/tv/${data.id}`);
	});

	app.get('/search', async (request,reply) => {
		const data = await Promise.all([Provider.searchSerie(request.query.q), Provider.searchMovie(request.query.q)]);
		return reply.view('templates/search.njk', { data, q: request.query.q })
	});

	app.get('/tv/:id', async (request, reply) => {
		let data = await Store.getSerie(request.params.id);

		if( data === undefined ){
			data = await Provider.getSerie(request.params.id);
			data.chapters = {};
			data.isAdded = false;
			data.first_aired_date = data.first_air_date;

			data.seasons.map( s => s.episodes ).flat().forEach(function(row){
				if( !data.chapters.hasOwnProperty(row.season_number) ){
					data.chapters[row.season_number] = [];
				}
				row.watched = null;
				data.chapters[row.season_number].push(row);
			});
		}

		return reply.view('templates/serie.njk', { data,chapters: Object.entries(data.chapters).sort((a,b) => a[0] - b[0]) })
	})

	app.get('/movie/:id', async (request, reply) => {
		let data = await Store.getMovie(request.params.id);
		if( data === undefined ){
			data = await Provider.getMovie(request.params.id);
			data.isAdded = false;
			data.watched = null;
		}
		return reply.view('templates/movie.njk', { data })
	})

	app.get('/movie/:id/add', async (request,reply) => {
		const data = await Provider.getMovie(request.params.id);
		await Store.addMovie(data);
		reply.redirect(`/movie/${data.id}`);
	});

	// Run the server!
	await app.listen({ host: "0.0.0.0", port: 8080 })


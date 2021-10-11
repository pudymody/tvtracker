import path from "path";
import got from "got";

import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

import { promises as fs, createWriteStream } from "fs";
import {pipeline} from 'stream';
import {promisify} from 'util'
const streamPipeline = promisify(pipeline);

async function download(url,file){
	try {
		await streamPipeline(
			got.stream(url),
			createWriteStream(file)
		);
	}catch(e){
		console.error(`Failed to download ${url} to ${file}`);
		console.error(e);
	}
};

const ASSETS_FOLDER = "assets/";
export default class SQLite {
	constructor(db){
		this.DB_FILE = db;
	}

	async open(){
		this.DB = await open({
			filename: this.DB_FILE,
			driver: sqlite3.Database
		})
	}

	async addSerie(data){
		try {
			await fs.mkdir(`assets/${data.id}`);
		}catch(e){
			if( e.code != "EEXIST" ){
				throw e;
			}
		}

		let images = [];
		if( data.backdrop_path !== null ){
			const backdrop_file = path.join(ASSETS_FOLDER, "series", String(data.id), "backdrop.jpg");
			images.push(download( data.backdrop_path, backdrop_file));
		}
		if( data.poster_path !== null ){
			const poster_file = path.join(ASSETS_FOLDER, "series", String(data.id), "poster.jpg");
			images.push(download( data.poster_path, poster_file));
		}
		await Promise.all(images);

		await this.DB.run(
			"INSERT OR REPLACE INTO series VALUES (?,?,?,?,?,?,?,?,?)",
			data.id,data.name,data.original_name,data.first_air_date,data.original_language,data.overview,data.status,data.tagline,data.vote_average
		);

		const stmt_season = await this.DB.prepare("INSERT OR REPLACE INTO seasons VALUES (?,?,?,?,?)");
		const stmt_chapter = await this.DB.prepare("INSERT OR REPLACE INTO chapters VALUES (?,?,?,?,?,?,?,?,?)");

		for( let s of data.seasons ){
			if( s.poster_path !== null ){
				await download( s.poster_path, `assets/${data.id}/s${s.season_number}.jpg`);
			}
			await stmt_season.run(s.id, s.name, s.season_number, s.overview, data.id);
			for( let c of s.episodes ){
				await stmt_chapter.run(c.id,c.episode_number, c.season_number, c.name, c.overview, c.air_date, c.vote_average, data.id, s.id);
			}
		}

		await stmt_season.finalize();
		await stmt_chapter.finalize();

		return data;
	}

	watchEpisode(id){
		return this.DB.run(
			`INSERT INTO watches VALUES (?,strftime("%Y-%m-%dT%H:%M:%fZ", "now"))`,
			id
		);
	}

	unwatchEpisode(id){
		return this.DB.run(
			`DELETE FROM watches WHERE id = ?`,
			id
		);
	}

	async addMovie(data){
		try {
			await fs.mkdir(`assets/movies/${data.id}`);
		}catch(e){
			if( e.code != "EEXIST" ){
				throw e;
			}
		}

		let images = [];
		if( data.backdrop_path !== null ){
			const backdrop_file = path.join(ASSETS_FOLDER, "movies", String(data.id), "backdrop.jpg");
			images.push(download( data.backdrop_path, backdrop_file));
		}
		if( data.poster_path !== null ){
			const poster_file = path.join(ASSETS_FOLDER, "movies", String(data.id), "poster.jpg");
			images.push(download( data.poster_path, poster_file));
		}
		await Promise.all(images);

		await this.DB.run(
			`INSERT OR REPLACE INTO movies VALUES (?,?,?,?,?,?,?,?,?,strftime("%Y-%m-%dT%H:%M:%fZ", "now"))`,
			data.id,data.imdb_id,data.title,data.original_title,data.overview,data.release_date,data.runtime,data.tagline,data.vote_average
		);

		return data;
	}
}

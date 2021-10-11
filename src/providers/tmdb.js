import got from "got";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
const TMDB_BASE = "https://api.themoviedb.org/3/";
export default class TMDB {
	constructor(key){
		this.API_KEY = key;
	}

	getSerie(id){
		const URL = `${TMDB_BASE}tv/${id}?api_key=${this.API_KEY}&language=en-US&append_to_response=images`;
		return got(URL, { responseType: "json" })
			.then( response => response.body )
			.then( ({backdrop_path,first_air_date,id,name,original_name,original_language,overview,poster_path,status,tagline,vote_average,seasons}) => {

				let backdrop_url = null, poster_url = null;
				if( backdrop_path !== null ){
					backdrop_url = `${TMDB_IMAGE_BASE}${backdrop_path}`;
				}
				if( poster_path !== null ){
					poster_url = `${TMDB_IMAGE_BASE}${poster_path}`;
				}
				return {backdrop_path:backdrop_url,first_air_date,id,name,original_name,original_language,overview,poster_path:poster_url,status,tagline,vote_average,seasons};
			})
			.then( async data => {
				data.seasons = await Promise.all(
					data.seasons.map(s => {
						return got(`${TMDB_BASE}tv/${data.id}/season/${s.season_number}?api_key=${this.API_KEY}&language=en-US&append_to_response=images`, { responseType: "json" })
							.then( r => r.body )
							.then( d => {
								let poster_url = null;
								if( d.poster_path !== null ){
									poster_url = `${TMDB_IMAGE_BASE}${d.poster_path}`
								}
								d.poster_path = poster_url;
								return d;
							});
					})
				);

				return data;
			});
	}

	getMovie(id){
		const URL = `${TMDB_BASE}movie/${id}?api_key=${this.API_KEY}&language=en-US&append_to_response=images`;
		return got(URL, { responseType: "json" })
			.then( response => response.body )
			.then( ({backdrop_path,id,imdb_id,original_title,overview,poster_path,release_date,runtime,tagline,title,vote_average}) => {

				let backdrop_url = null, poster_url = null;
				if( backdrop_path !== null ){
					backdrop_url = `${TMDB_IMAGE_BASE}${backdrop_path}`;
				}
				if( poster_path !== null ){
					poster_url = `${TMDB_IMAGE_BASE}${poster_path}`;
				}
				return {backdrop_path:backdrop_url,poster_path:poster_url,id,imdb_id,original_title,overview,release_date,runtime,tagline,title,vote_average};
			})
	}
}

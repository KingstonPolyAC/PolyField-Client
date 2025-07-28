export namespace main {
	
	export class Athlete {
	    bib: string;
	    order: number;
	    name: string;
	    club: string;
	
	    static createFrom(source: any = {}) {
	        return new Athlete(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bib = source["bib"];
	        this.order = source["order"];
	        this.name = source["name"];
	        this.club = source["club"];
	    }
	}
	export class AveragedEDMReading {
	    SlopeDistanceMm: number;
	    VAzDecimal: number;
	    HARDecimal: number;
	
	    static createFrom(source: any = {}) {
	        return new AveragedEDMReading(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.SlopeDistanceMm = source["SlopeDistanceMm"];
	        this.VAzDecimal = source["VAzDecimal"];
	        this.HARDecimal = source["HARDecimal"];
	    }
	}
	export class EdgeVerificationResult {
	    MeasuredRadius: number;
	    DifferenceMm: number;
	    ToleranceAppliedMm: number;
	    IsInTolerance: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EdgeVerificationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.MeasuredRadius = source["MeasuredRadius"];
	        this.DifferenceMm = source["DifferenceMm"];
	        this.ToleranceAppliedMm = source["ToleranceAppliedMm"];
	        this.IsInTolerance = source["IsInTolerance"];
	    }
	}
	export class EDMPoint {
	    X: number;
	    Y: number;
	
	    static createFrom(source: any = {}) {
	        return new EDMPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.X = source["X"];
	        this.Y = source["Y"];
	    }
	}
	export class EDMCalibrationData {
	    DeviceID: string;
	    // Go type: time
	    Timestamp: any;
	    SelectedCircleType: string;
	    TargetRadius: number;
	    StationCoordinates: EDMPoint;
	    IsCentreSet: boolean;
	    EdgeVerificationResult?: EdgeVerificationResult;
	
	    static createFrom(source: any = {}) {
	        return new EDMCalibrationData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.DeviceID = source["DeviceID"];
	        this.Timestamp = this.convertValues(source["Timestamp"], null);
	        this.SelectedCircleType = source["SelectedCircleType"];
	        this.TargetRadius = source["TargetRadius"];
	        this.StationCoordinates = this.convertValues(source["StationCoordinates"], EDMPoint);
	        this.IsCentreSet = source["IsCentreSet"];
	        this.EdgeVerificationResult = this.convertValues(source["EdgeVerificationResult"], EdgeVerificationResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class EventRules {
	    attempts: number;
	    cutEnabled: boolean;
	    cutQualifiers: number;
	    reorderAfterCut: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EventRules(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.attempts = source["attempts"];
	        this.cutEnabled = source["cutEnabled"];
	        this.cutQualifiers = source["cutQualifiers"];
	        this.reorderAfterCut = source["reorderAfterCut"];
	    }
	}
	export class Event {
	    id: string;
	    name: string;
	    type: string;
	    rules?: EventRules;
	    athletes?: Athlete[];
	
	    static createFrom(source: any = {}) {
	        return new Event(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.rules = this.convertValues(source["rules"], EventRules);
	        this.athletes = this.convertValues(source["athletes"], Athlete);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Performance {
	    attempt: number;
	    mark: string;
	    unit: string;
	    wind?: string;
	    valid: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Performance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.attempt = source["attempt"];
	        this.mark = source["mark"];
	        this.unit = source["unit"];
	        this.wind = source["wind"];
	        this.valid = source["valid"];
	    }
	}
	export class ResultPayload {
	    eventId: string;
	    athleteBib: string;
	    series: Performance[];
	
	    static createFrom(source: any = {}) {
	        return new ResultPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.eventId = source["eventId"];
	        this.athleteBib = source["athleteBib"];
	        this.series = this.convertValues(source["series"], Performance);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}


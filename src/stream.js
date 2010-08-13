(function(){
    Gordon.Stream = function(data){
        var t = this;
        t.offset = 0;
        t._buffer = data;
        t._length = t._buffer.length;
        t._bitBuffer = null;
        t._bitOffset = 8;
    };
    Gordon.Stream.prototype = {
        decompress: function() {
            var t = this;
            t.offset += 2;
            var hdr = t._buffer.substr(0, t.offset),
                d = t._buffer.substr(t.offset),
                data = zip_inflate(d);
            t._buffer = hdr + data;
            t._length = t._buffer.length;
            return t;
        },
        
        readByteAt: function(pos){
            return this._buffer.charCodeAt(pos) & 0xff;
        },
        
        readNumber: function(numBytes, bigEnd){
            var t = this,
                val = 0;
            if(bigEnd){
                var i = numBytes;
                while(i--){ val = (val << 8) + t.readByteAt(t.offset++); }
            }else{
                var o = t.offset,
                    i = o + numBytes;
                while(i > o){ val = (val << 8) + t.readByteAt(--i); }
                t.offset += numBytes;
            }
            t.align();
            return val;
        },
        
        readSNumber: function(numBytes, bigEnd){
            var val = this.readNumber(numBytes, bigEnd),
                numBits = numBytes * 8;
            if(val >> (numBits - 1)){ val -= Math.pow(2, numBits); }
            return val;
        },
        
        readSI8: function(){
            return this.readSNumber(1);
        },
        
        readSI16: function(bigEnd){
            return this.readSNumber(2, bigEnd);
        },
        
        readSI32: function(bigEnd){
            return this.readSNumber(4, bigEnd);
        },
        
        readUI8: function(){
            return this.readNumber(1);
        },
        
        readUI16: function(bigEnd){
            return this.readNumber(2, bigEnd);
        },
        
        readUI24: function(bigEnd){
            return this.readNumber(3, bigEnd);
        },
        
        readUI32: function(bigEnd){
            return this.readNumber(4, bigEnd);
        },
        
        readFixed: function(){
            return this._readFixedPoint(32, 16);
        },
        
        _readFixedPoint: function(numBits, precision){
            return this.readSB(numBits) * Math.pow(2, -precision);
        },
        
        readFixed8: function(){
            return this._readFixedPoint(16, 8);
        },
        
        readFloat: function(){
            return this._readFloatingPoint(8, 23);
        },
        
        _readFloatingPoint: function(numEbits, numSbits){
            var numBits = 1 + numEbits + numSbits,
                numBytes = numBits / 8,
                t = this,
                val = 0.0;
            if(numBytes > 4){
                var buff = '',
                    i = Math.ceil(numBytes / 4);
                while(i--){
                    var o = t.offset,
                        j = o + (numBytes >= 4 ? 4 : numBytes % 4);
                    while(j > o){
                        buff += String.fromCharCode(t.readByteAt(--j));
                        numBytes--;
                        t.offset++;
                    }
                }
                var s = new Gordon.Stream(buff),
                    sign = s.readUB(1),
                    expo = s.readUB(numEbits),
                    mantis = 0;
                for(var d = numSbits; d >= 0; d--){
                    if(s.readBool()){ mantis += Math.pow(2, d - 1); }
                }
            }else{
                var sign = t.readUB(1),
                    expo = t.readUB(numEbits),
                    mantis = t.readUB(numSbits);
            }
            if(sign || expo || mantis){
                var maxExpo = Math.pow(2, numEbits),
                    bias = ~~((maxExpo - 1) / 2),
                    scale = Math.pow(2, numSbits),
                    fract = mantis / scale;
                if(bias){
                    if(bias < maxExpo){ val = Math.pow(2, expo - bias) * (1 + fract); }
                    else if(fract){ val = NaN; }
                    else{ val = Infinity; }
                }else if(fract){ val = Math.pow(2, 1 - bias) * fract; }
                if(val != NaN && sign){ val *= -1; }
            }
            return val;
        },
        
        readFloat16: function(){
            return this._readFloatingPoint(5, 10);
        },
        
        readDouble: function(){
            return this._readFloatingPoint(11, 52);
        },
        
        readEncodedU32: function(){
            var val = 0,
                i = 5;
            while(i--){
                var num = this.readByteAt(this.offset++);
                val = (val << 7) + (num & 0x7f);
                if(!(num & 0x80)){ break; }
            }
            return val;
        },
        
        readSB: function(numBits){
            var val = this.readUB(numBits);
            if(val >> (numBits - 1)){ val -= Math.pow(2, numBits); }
            return val;
        },
        
        readUB: function(numBits){
            var t = this,
                val = 0,
                i = numBits;
            while(i--){
                if(8 == t._bitOffset){
                    t._bitBuffer = t.readUI8();
                    t._bitOffset = 0;
                }
                val = (val << 1) + (t._bitBuffer & (0x80 >> t._bitOffset) ? 1 : 0);
                t._bitOffset++;
            }
            return val;
        },
        
        readFB: function(numBits){
            return this._readFixedPoint(numBits, 16);
        },
        
        readString: function(numChars){
            var t = this,
                b = t._buffer;
            if(undefined != numChars){
                var str = b.substr(t.offset, numChars);
                t.offset += numChars;
            }else{
                numChars = t._length - t.offset;
                var chars = [],
                    i = numChars;
                while(i--){
                    var code = t.readByteAt(t.offset++);
                    if(code){ chars.push(String.fromCharCode(code)); }
                    else{ break; }
                }
                var str = chars.join('');
            }
            return str;
        },
        
        readBool: function(numBits){
            return !!this.readUB(numBits || 1);
        },
        
        readLanguageCode: function(){
            return this.readUI8();
        },
        
        readRGB: function(){
            return {
                red: this.readUI8(),
                green: this.readUI8(),
                blue: this.readUI8()
            }
        },
        
        readRGBA: function(){
            var rgba = this.readRGB();
            rgba.alpha = this.readUI8() / 256;
            return rgba;
        },
        
        readARGB: function(){
            var alpha = this.readUI8() / 256,
                rgba = this.readRGB();
            rgba.alpha = alpha;
            return rgba;
        },
        
        readRect: function(){
            var t = this;
                numBits = t.readUB(5),
                rect = {
                    left: t.readSB(numBits),
                    right: t.readSB(numBits),
                    top: t.readSB(numBits),
                    bottom: t.readSB(numBits)
                };
            t.align();
            return rect;
        },
        
        readMatrix: function(){
            var t = this,
                hasScale = t.readBool();
            if(hasScale){
                var numBits = t.readUB(5),
                    scaleX = t.readFB(numBits),
                    scaleY = t.readFB(numBits);
            }else{ var scaleX = scaleY = 1.0; }
            var hasRotation = t.readBool();
            if(hasRotation){
                var numBits = t.readUB(5),
                    skewX = t.readFB(numBits),
                    skewY = t.readFB(numBits);
            }else{ var skewX =  skewY = 0.0; }
            var numBits = t.readUB(5);
                matrix = {
                    scaleX: scaleX, scaleY: scaleY,
                    skewX: skewX, skewY: skewY,
                    moveX: t.readSB(numBits), moveY: t.readSB(numBits)
                };
            t.align();
            return matrix;
        },
        
        readCxform: function(){
            return this._readCxf();
        },
        
        readCxformA: function(){
            return this._readCxf(true);
        },
        
        _readCxf: function(withAlpha){
            var t = this;
                hasAddTerms = t.readBool(),
                hasMultTerms = t.readBool(),
                numBits = t.readUB(4);
            if(hasMultTerms){
                var multR = t.readSB(numBits) / 256,
                    multG = t.readSB(numBits) / 256,
                    multB = t.readSB(numBits) / 256,
                    multA = withAlpha ? t.readSB(numBits) / 256 : 1;
            }else{ var multR = multG = multB = multA = 1; }
            if(hasAddTerms){
                var addR = t.readSB(numBits),
                    addG = t.readSB(numBits),
                    addB = t.readSB(numBits),
                    addA = withAlpha ? t.readSB(numBits) : 0;
            }else{ var addR = addG = addB = addA = 0; }
            var cxform = {
                multR: multR, multG: multG, multB: multB, multA: multA,
                addR: addR, addG: addG, addB: addB, addA: addA
            }
            t.align();
            return cxform;
        },
        
        seek: function(offset, absolute){
            this.offset = (absolute ? 0 : this.offset) + offset;
            return this;
        },
        
        align: function(){
            this._bitBuffer = null;
            this._bitOffset = 8;
            return this;
        }
    };
}());
